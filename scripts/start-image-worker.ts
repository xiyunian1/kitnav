import { rename, unlink, writeFile } from "node:fs/promises";
import { assertDatabaseReady } from "@/lib/database-readiness";
import { logger } from "@/lib/logger";
import {
  getImageWorkerRuntimeState,
  startImageWorker,
  stopImageWorker,
} from "@/lib/image-worker";

const readyFile =
  process.env.IMAGE_WORKER_READY_FILE || "/tmp/image-worker-health.json";
const heartbeatIntervalMs = Number(
  process.env.IMAGE_WORKER_HEARTBEAT_MS || 10_000,
);
let stopping = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight: Promise<void> | null = null;

async function writeHeartbeat() {
  await assertDatabaseReady();
  const temporaryFile = `${readyFile}.${process.pid}.tmp`;
  await writeFile(
    temporaryFile,
    `${JSON.stringify({
      version: 1,
      pid: process.pid,
      checkedAt: Date.now(),
      ...getImageWorkerRuntimeState(),
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryFile, readyFile);
}

function refreshHeartbeat(propagateError = false) {
  if (stopping || heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = writeHeartbeat()
    .catch((error) => {
      logger.error("image-worker", "图片 Worker 数据库心跳失败", { error });
      if (propagateError) throw error;
    })
    .finally(() => {
      heartbeatInFlight = null;
    });
  return heartbeatInFlight;
}

async function main() {
  if (
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1_000 ||
    heartbeatIntervalMs > 2_147_483_647
  ) {
    throw new Error("IMAGE_WORKER_HEARTBEAT_MS 必须是 1000 到 2147483647 之间的整数");
  }
  startImageWorker();
  await refreshHeartbeat(true);
  heartbeatTimer = setInterval(() => void refreshHeartbeat(), heartbeatIntervalMs);
  logger.info("image-worker", "独立图片 Worker 已启动", { pid: process.pid });

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info("image-worker", "收到停机信号，正在重新排队活跃任务", {
      signal,
    });
    void stopImageWorker()
      .then(() => 0)
      .catch((error) => {
        logger.error("image-worker", "图片 Worker 优雅停机失败", { error });
        return 1;
      })
      .then(async (exitCode) => {
        await unlink(readyFile).catch(() => undefined);
        process.exit(exitCode);
      });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  await new Promise<void>(() => undefined);
}

void main().catch(async (error) => {
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  logger.error("image-worker", "图片 Worker 启动失败", { error });
  await stopImageWorker().catch(() => undefined);
  await unlink(readyFile).catch(() => undefined);
  process.exitCode = 1;
});
