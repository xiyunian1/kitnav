import { rename, unlink, writeFile } from "node:fs/promises";
import { assertDatabaseReady } from "@/lib/database-readiness";
import { logger } from "@/lib/logger";
import {
  getPptWorkerRuntimeState,
  startPptWorker,
  stopPptWorker,
} from "@/lib/ppt-agent/worker";

const readyFile =
  process.env.PPT_WORKER_READY_FILE || "/tmp/ppt-worker-health.json";
const heartbeatIntervalMs = Number(
  process.env.PPT_WORKER_HEARTBEAT_MS || 10_000,
);
let stopping = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatInFlight: Promise<void> | null = null;

async function writeHeartbeat() {
  await assertDatabaseReady();
  const state = getPptWorkerRuntimeState();
  const temporaryFile = `${readyFile}.${process.pid}.tmp`;
  await writeFile(
    temporaryFile,
    `${JSON.stringify({
      version: 1,
      pid: process.pid,
      checkedAt: Date.now(),
      ...state,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporaryFile, readyFile);
}

function refreshHeartbeat(propagateError = false) {
  if (stopping || heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = writeHeartbeat()
    .catch((error) => {
      logger.error("ppt-worker", "PPT worker 数据库心跳失败", { error });
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
    throw new Error("PPT_WORKER_HEARTBEAT_MS 必须是 1000 到 2147483647 之间的整数");
  }
  startPptWorker();
  await refreshHeartbeat(true);
  heartbeatTimer = setInterval(() => {
    void refreshHeartbeat();
  }, heartbeatIntervalMs);
  logger.info("ppt-worker", "独立 PPT worker 已启动", { pid: process.pid });

  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info("ppt-worker", "收到停机信号，正在重新排队活跃任务", { signal });
    void stopPptWorker()
      .then(() => 0)
      .catch((error) => {
        logger.error("ppt-worker", "优雅停机失败", { error });
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
  heartbeatTimer = null;
  logger.error("ppt-worker", "PPT worker 启动失败", { error });
  await stopPptWorker().catch(() => undefined);
  await unlink(readyFile).catch(() => undefined);
  process.exitCode = 1;
});
