import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  getImageInputRetentionMs,
  getImageWorkerConcurrency,
} from "@/lib/image-worker-config";
import { boundedIntegerEnv } from "@/lib/runtime-config";
import {
  parseStoredImageInputReferences,
  sweepOrphanImageInputs,
} from "@/lib/image-inputs";
import {
  sweepOrphanUploadStorage,
  type UploadStorageSweepRunResult,
} from "@/lib/upload-storage-retention";
import { sweepExpiredImageArtifacts } from "@/lib/image-result-retention";
import {
  claimNextImageTurn,
  executeImageTurn,
  ImageWorkerShutdownError,
  requeueImageTurn,
  sweepStaleImageTurns,
} from "@/lib/image-workbench";

const POLL_INTERVAL_MS = boundedIntegerEnv("IMAGE_WORKER_POLL_MS", 1_500, {
  min: 100,
});
const SWEEP_INTERVAL_MS = boundedIntegerEnv("IMAGE_WORKER_SWEEP_MS", 30_000, {
  min: 1_000,
});
const INPUT_SWEEP_INTERVAL_MS = boundedIntegerEnv(
  "IMAGE_INPUT_SWEEP_MS",
  6 * 60 * 60 * 1000,
  { min: 60_000 },
);
const INPUT_RETENTION_MS = getImageInputRetentionMs();
const UPLOAD_STORAGE_SWEEP_INTERVAL_MS = boundedIntegerEnv(
  "UPLOAD_STORAGE_SWEEP_MS",
  6 * 60 * 60 * 1000,
  { min: 60_000 },
);

let started = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let inputSweepTimer: ReturnType<typeof setInterval> | null = null;
let uploadStorageSweepTimer: ReturnType<typeof setInterval> | null = null;
let uploadStorageSweepInFlight: Promise<void> | null = null;
let uploadStorageSweepState: {
  running: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastResult: UploadStorageSweepRunResult | null;
  lastError: string | null;
} = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastResult: null,
  lastError: null,
};
const pollLoops = new Set<Promise<void>>();
const activeJobs = new Map<
  string,
  { lease: string; controller: AbortController; promise: Promise<void> }
>();

export { getImageWorkerConcurrency };

export function getImageWorkerRuntimeState() {
  return {
    started,
    activeJobs: activeJobs.size,
    pollLoops: pollLoops.size,
    expectedPollLoops: started ? getImageWorkerConcurrency() : 0,
    uploadStorageSweep: { ...uploadStorageSweepState },
  };
}

export function startImageWorker() {
  if (started) return;
  started = true;
  for (let index = 0; index < getImageWorkerConcurrency(); index += 1) {
    const loop = pollLoop(index);
    pollLoops.add(loop);
    void loop.finally(() => pollLoops.delete(loop));
  }
  sweepTimer = setInterval(() => {
    void sweepStaleImageTurns()
      .then((result) => {
        if (result.requeued > 0 || result.failed > 0) {
          logger.warn("image-worker", "图片任务超时扫描完成", result);
        }
      })
      .catch((error) =>
        logger.error("image-worker", "图片任务超时扫描失败", { error }),
      );
  }, SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  void sweepImageInputs();
  inputSweepTimer = setInterval(() => void sweepImageInputs(), INPUT_SWEEP_INTERVAL_MS);
  if (typeof inputSweepTimer.unref === "function") inputSweepTimer.unref();

  void runUploadStorageSweep();
  uploadStorageSweepTimer = setInterval(
    () => void runUploadStorageSweep(),
    UPLOAD_STORAGE_SWEEP_INTERVAL_MS,
  );
  if (typeof uploadStorageSweepTimer.unref === "function") {
    uploadStorageSweepTimer.unref();
  }
}

export async function stopImageWorker(timeoutMs = 20_000) {
  if (!started) return;
  started = false;
  if (sweepTimer) clearInterval(sweepTimer);
  if (inputSweepTimer) clearInterval(inputSweepTimer);
  if (uploadStorageSweepTimer) clearInterval(uploadStorageSweepTimer);
  sweepTimer = null;
  inputSweepTimer = null;
  uploadStorageSweepTimer = null;

  for (const job of activeJobs.values()) {
    job.controller.abort(new ImageWorkerShutdownError());
  }
  const settled = await waitForShutdown(
    [
      ...pollLoops,
      ...[...activeJobs.values()].map((job) => job.promise),
      ...(uploadStorageSweepInFlight ? [uploadStorageSweepInFlight] : []),
    ],
    timeoutMs,
  );
  if (!settled && activeJobs.size > 0) {
    const interrupted = [...activeJobs.entries()];
    const results = await Promise.allSettled(
      interrupted.map(([turnId, job]) => requeueImageTurn(turnId, job.lease)),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "图片 Worker 停机时无法重新排队全部活跃任务",
      );
    }
    logger.warn("image-worker", "停机等待超时，活跃图片任务已强制重新排队", {
      interrupted: interrupted.length,
      requeued: results.filter(
        (result) => result.status === "fulfilled" && result.value,
      ).length,
    });
  }
}

async function pollLoop(workerIndex: number) {
  while (started) {
    try {
      const claimed = await claimNextImageTurn();
      if (claimed) {
        if (!started) {
          await requeueImageTurn(claimed.id, claimed.lease).catch(() => false);
          break;
        }
        const controller = new AbortController();
        const promise = processClaimedTurn(
          claimed.id,
          claimed.lease,
          controller,
        );
        activeJobs.set(claimed.id, {
          lease: claimed.lease,
          controller,
          promise,
        });
        try {
          await promise;
        } finally {
          activeJobs.delete(claimed.id);
        }
        continue;
      }
    } catch (error) {
      logger.error("image-worker", "图片队列轮询失败", { workerIndex, error });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function processClaimedTurn(
  turnId: string,
  lease: string,
  controller: AbortController,
) {
  try {
    await executeImageTurn(turnId, lease, controller.signal);
  } catch (error) {
    if (!(error instanceof ImageWorkerShutdownError)) {
      logger.error("image-worker", "图片任务执行异常，任务将重新排队", {
        turnId,
        error,
      });
    }
    await requeueImageTurn(turnId, lease).catch((requeueError) => {
      logger.error("image-worker", "图片任务重新排队失败", {
        turnId,
        error: requeueError,
      });
      return false;
    });
  }
}

async function sweepImageInputs() {
  try {
    const active = await prisma.imageTurn.findMany({
      where: {
        status: "PENDING",
        OR: [{ editInputs: { not: null } }, { editInputPath: { not: null } }],
      },
      select: { editInputs: true, editInputPath: true, editInputName: true },
    });
    const activeTokens = new Set(
      active.flatMap((turn) =>
        parseStoredImageInputReferences(
          turn.editInputs,
          turn.editInputPath,
          turn.editInputName,
        ).map((reference) => reference.token),
      ),
    );
    const result = await sweepOrphanImageInputs(
      activeTokens,
      INPUT_RETENTION_MS,
    );
    if (result.removed > 0) {
      logger.info("image-worker", "孤立图片参考文件清理完成", result);
    }
  } catch (error) {
    logger.error("image-worker", "孤立图片参考文件清理失败", { error });
  }
}

function runUploadStorageSweep() {
  if (uploadStorageSweepInFlight) return uploadStorageSweepInFlight;
  uploadStorageSweepState = {
    running: true,
    lastStartedAt: Date.now(),
    lastFinishedAt: uploadStorageSweepState.lastFinishedAt,
    lastResult: uploadStorageSweepState.lastResult,
    lastError: null,
  };
  uploadStorageSweepInFlight = sweepExpiredImageArtifacts()
    .then((result) => {
      if (
        result.turnsExpired > 0 ||
        result.filesRemoved > 0 ||
        result.filesPreserved > 0
      ) {
        logger.info("image-worker", "过期生成图片清理完成", { ...result });
      }
    })
    .catch((error) => {
      logger.error("image-worker", "过期生成图片清理失败", { error });
    })
    .then(() => sweepOrphanUploadStorage())
    .then((result) => {
      uploadStorageSweepState.lastResult = result;
      logger.info("image-worker", "上传孤儿文件清理完成", { ...result });
    })
    .catch((error) => {
      uploadStorageSweepState.lastResult = null;
      uploadStorageSweepState.lastError = errorMessage(error);
      logger.error("image-worker", "上传孤儿文件清理失败", { error });
    })
    .finally(() => {
      uploadStorageSweepState.running = false;
      uploadStorageSweepState.lastFinishedAt = Date.now();
      uploadStorageSweepInFlight = null;
    });
  return uploadStorageSweepInFlight;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function waitForShutdown(promises: Promise<unknown>[], timeoutMs: number) {
  return new Promise<boolean>((resolve) => {
    let finished = false;
    const complete = (settled: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(settled);
    };
    const timer = setTimeout(() => complete(false), Math.max(0, timeoutMs));
    void Promise.allSettled(promises).then(() => complete(true));
  });
}
