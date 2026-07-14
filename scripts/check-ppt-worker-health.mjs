import { readFile } from "node:fs/promises";

const healthFile =
  process.env.PPT_WORKER_READY_FILE || "/tmp/ppt-worker-health.json";
const maxAgeMs = Number(process.env.PPT_WORKER_HEALTH_MAX_AGE_MS || 45_000);

function fail(message) {
  console.error(`PPT worker unhealthy: ${message}`);
  process.exit(1);
}

if (
  !Number.isSafeInteger(maxAgeMs) ||
  maxAgeMs < 5_000 ||
  maxAgeMs > 2_147_483_647
) {
  fail("PPT_WORKER_HEALTH_MAX_AGE_MS must be an integer from 5000 to 2147483647");
}

let health;
try {
  health = JSON.parse(await readFile(healthFile, "utf8"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (!Number.isSafeInteger(health?.pid) || health.pid <= 0) {
  fail("invalid worker pid");
}
try {
  if (process.platform === "linux") {
    const processStatus = await readFile(`/proc/${health.pid}/status`, "utf8");
    if (/^State:\s+Z\b/m.test(processStatus)) {
      fail(`worker process ${health.pid} is a zombie`);
    }
  } else {
    process.kill(health.pid, 0);
  }
} catch {
  fail(`worker process ${health.pid} is not running`);
}

const heartbeatAgeMs = Date.now() - Number(health.checkedAt);
if (
  !Number.isFinite(heartbeatAgeMs) ||
  heartbeatAgeMs < -5_000 ||
  heartbeatAgeMs > maxAgeMs
) {
  fail(`database heartbeat is stale (${heartbeatAgeMs}ms)`);
}
if (health.started !== true) {
  fail("worker is stopping");
}
if (
  !Number.isSafeInteger(health.pollLoops) ||
  !Number.isSafeInteger(health.expectedPollLoops) ||
  health.expectedPollLoops < 1 ||
  health.pollLoops < health.expectedPollLoops
) {
  fail(
    `queue consumers are incomplete (${health?.pollLoops ?? "?"}/${health?.expectedPollLoops ?? "?"})`,
  );
}
