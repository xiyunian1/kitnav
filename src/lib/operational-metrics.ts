import { statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { IMAGE_WORKER_STALE_TIMEOUT_MS } from "@/lib/image-worker-config";
import {
  PPT_PROCESSING_STATUSES,
  PPT_RUNNING_STATUSES,
} from "@/lib/ppt-agent/status";
import { getStaleActiveProjectMs } from "@/lib/ppt-agent/timings";
import {
  getImageGlobalMaxPending,
  getPptGlobalMaxPending,
} from "@/lib/queue-capacity";

export interface OperationalMetricsSnapshot {
  collectedAt: number;
  databaseQueryDurationMs: number;
  databaseConnections: { used: number; max: number };
  imageQueue: {
    queued: number;
    running: number;
    stale: number;
    capacity: number;
    oldestCreatedAt: Date | null;
  };
  pptQueue: {
    queued: number;
    running: number;
    stale: number;
    capacity: number;
    oldestCreatedAt: Date | null;
  };
  generations: Array<{
    module: string;
    status: string;
    count: number;
    averageDurationMs: number | null;
  }>;
  pptStatuses: Array<{ status: string; count: number }>;
  pendingPptRefunds: number;
  users: number;
  materialBytes: number;
  rateLimitBuckets: number;
  filesystem: { totalBytes: number; availableBytes: number } | null;
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number };
}

interface DatabaseConnectionRow {
  used: number;
  max: number;
}

let cached:
  | { expiresAt: number; value: Promise<OperationalMetricsSnapshot> }
  | undefined;

export function collectOperationalMetrics() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const value = collectOperationalMetricsUncached().catch((error) => {
    cached = undefined;
    throw error;
  });
  cached = { expiresAt: now + 15_000, value };
  return value;
}

async function collectOperationalMetricsUncached(): Promise<OperationalMetricsSnapshot> {
  const collectedAt = Date.now();
  const since = new Date(collectedAt - 60 * 60 * 1000);
  const staleImageBefore = new Date(
    collectedAt - IMAGE_WORKER_STALE_TIMEOUT_MS,
  );
  const stalePptBefore = new Date(collectedAt - getStaleActiveProjectMs());
  const queryStartedAt = performance.now();
  const [
    imageQueued,
    imageRunning,
    imageStale,
    oldestImage,
    pptQueued,
    pptRunning,
    pptStale,
    oldestPpt,
    generations,
    pptStatuses,
    pendingPptRefunds,
    users,
    materialSize,
    rateLimitBuckets,
    databaseConnectionRows,
  ] = await Promise.all([
    prisma.imageTurn.count({
      where: { status: "PENDING", workerLease: null },
    }),
    prisma.imageTurn.count({
      where: {
        status: "PENDING",
        workerLease: { not: null },
        heartbeatAt: { gte: staleImageBefore },
      },
    }),
    prisma.imageTurn.count({
      where: {
        status: "PENDING",
        workerLease: { not: null },
        OR: [
          { heartbeatAt: { lt: staleImageBefore } },
          { heartbeatAt: null },
        ],
      },
    }),
    prisma.imageTurn.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.pptProject.count({
      where: { status: "QUEUED", workerLease: null },
    }),
    prisma.pptProject.count({
      where: {
        status: { in: [...PPT_RUNNING_STATUSES] },
        workerLease: { not: null },
        updatedAt: { gte: stalePptBefore },
      },
    }),
    prisma.pptProject.count({
      where: {
        OR: [
          { status: "QUEUED", workerLease: { not: null } },
          {
            status: { in: [...PPT_RUNNING_STATUSES] },
            workerLease: null,
          },
          {
            status: { in: [...PPT_RUNNING_STATUSES] },
            workerLease: { not: null },
            updatedAt: { lt: stalePptBefore },
          },
        ],
      },
    }),
    prisma.pptProject.findFirst({
      where: { status: { in: [...PPT_PROCESSING_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.generation.groupBy({
      by: ["module", "status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
    }),
    prisma.pptProject.groupBy({
      by: ["status"],
      where: { updatedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.pptProject.count({
      where: {
        status: "FAILED",
        usedOwnKey: false,
        creditsCost: { gt: 0 },
      },
    }),
    prisma.user.count(),
    prisma.material.aggregate({ _sum: { sizeBytes: true } }),
    prisma.rateLimitBucket.count(),
    prisma.$queryRaw<DatabaseConnectionRow[]>`
      SELECT
        (SELECT COUNT(*)::integer FROM pg_stat_activity) AS "used",
        current_setting('max_connections')::integer AS "max"
    `,
  ]);
  const databaseQueryDurationMs = performance.now() - queryStartedAt;
  const databaseConnections = databaseConnectionRows[0];
  if (
    !databaseConnections ||
    !Number.isSafeInteger(databaseConnections.used) ||
    !Number.isSafeInteger(databaseConnections.max) ||
    databaseConnections.used < 0 ||
    databaseConnections.max < 1
  ) {
    throw new Error("PostgreSQL returned invalid connection statistics.");
  }

  let filesystem: OperationalMetricsSnapshot["filesystem"] = null;
  try {
    const stats = await statfs(resolve(process.cwd(), "data"), { bigint: true });
    filesystem = {
      totalBytes: Number(stats.bsize * stats.blocks),
      availableBytes: Number(stats.bsize * stats.bavail),
    };
  } catch {
    filesystem = null;
  }
  const memory = process.memoryUsage();
  return {
    collectedAt,
    databaseQueryDurationMs,
    databaseConnections,
    imageQueue: {
      queued: imageQueued,
      running: imageRunning,
      stale: imageStale,
      capacity: getImageGlobalMaxPending(),
      oldestCreatedAt: oldestImage?.createdAt ?? null,
    },
    pptQueue: {
      queued: pptQueued,
      running: pptRunning,
      stale: pptStale,
      capacity: getPptGlobalMaxPending(),
      oldestCreatedAt: oldestPpt?.createdAt ?? null,
    },
    generations: generations.map((row) => ({
      module: row.module,
      status: row.status,
      count: row._count._all,
      averageDurationMs: row._avg.durationMs,
    })),
    pptStatuses: pptStatuses.map((row) => ({
      status: row.status,
      count: row._count._all,
    })),
    pendingPptRefunds,
    users,
    materialBytes: materialSize._sum.sizeBytes ?? 0,
    rateLimitBuckets,
    filesystem,
    process: {
      uptimeSeconds: process.uptime(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
  };
}

function labels(values: Record<string, string>) {
  const body = Object.entries(values)
    .map(
      ([key, value]) =>
        `${key}="${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"')}"`,
    )
    .join(",");
  return `{${body}}`;
}

function queueAgeSeconds(value: Date | null, now: number) {
  return value ? Math.max(0, (now - value.getTime()) / 1000) : 0;
}

function queueUtilization(queue: {
  queued: number;
  running: number;
  stale: number;
  capacity: number;
}) {
  return (queue.queued + queue.running + queue.stale) / queue.capacity;
}

export function renderOperationalMetrics(snapshot: OperationalMetricsSnapshot) {
  const lines = [
    "# HELP ai_aggregator_up Application metrics collection succeeded.",
    "# TYPE ai_aggregator_up gauge",
    "ai_aggregator_up 1",
    "# HELP ai_aggregator_database_query_duration_seconds Database metrics query latency.",
    "# TYPE ai_aggregator_database_query_duration_seconds gauge",
    `ai_aggregator_database_query_duration_seconds ${snapshot.databaseQueryDurationMs / 1000}`,
    "# HELP ai_aggregator_database_connections Current and maximum PostgreSQL connections.",
    "# TYPE ai_aggregator_database_connections gauge",
    `ai_aggregator_database_connections${labels({ state: "used" })} ${snapshot.databaseConnections.used}`,
    `ai_aggregator_database_connections${labels({ state: "max" })} ${snapshot.databaseConnections.max}`,
    "# HELP ai_aggregator_queue_jobs Current jobs by queue and state.",
    "# TYPE ai_aggregator_queue_jobs gauge",
    `ai_aggregator_queue_jobs${labels({ queue: "image", state: "queued" })} ${snapshot.imageQueue.queued}`,
    `ai_aggregator_queue_jobs${labels({ queue: "image", state: "running" })} ${snapshot.imageQueue.running}`,
    `ai_aggregator_queue_jobs${labels({ queue: "image", state: "stale" })} ${snapshot.imageQueue.stale}`,
    `ai_aggregator_queue_jobs${labels({ queue: "ppt", state: "queued" })} ${snapshot.pptQueue.queued}`,
    `ai_aggregator_queue_jobs${labels({ queue: "ppt", state: "running" })} ${snapshot.pptQueue.running}`,
    `ai_aggregator_queue_jobs${labels({ queue: "ppt", state: "stale" })} ${snapshot.pptQueue.stale}`,
    "# HELP ai_aggregator_queue_capacity Maximum unfinished jobs accepted by a queue.",
    "# TYPE ai_aggregator_queue_capacity gauge",
    `ai_aggregator_queue_capacity${labels({ queue: "image" })} ${snapshot.imageQueue.capacity}`,
    `ai_aggregator_queue_capacity${labels({ queue: "ppt" })} ${snapshot.pptQueue.capacity}`,
    "# HELP ai_aggregator_queue_utilization_ratio Fraction of queue capacity currently used.",
    "# TYPE ai_aggregator_queue_utilization_ratio gauge",
    `ai_aggregator_queue_utilization_ratio${labels({ queue: "image" })} ${queueUtilization(snapshot.imageQueue)}`,
    `ai_aggregator_queue_utilization_ratio${labels({ queue: "ppt" })} ${queueUtilization(snapshot.pptQueue)}`,
    "# HELP ai_aggregator_queue_oldest_age_seconds Age of the oldest unfinished job.",
    "# TYPE ai_aggregator_queue_oldest_age_seconds gauge",
    `ai_aggregator_queue_oldest_age_seconds${labels({ queue: "image" })} ${queueAgeSeconds(snapshot.imageQueue.oldestCreatedAt, snapshot.collectedAt)}`,
    `ai_aggregator_queue_oldest_age_seconds${labels({ queue: "ppt" })} ${queueAgeSeconds(snapshot.pptQueue.oldestCreatedAt, snapshot.collectedAt)}`,
    "# HELP ai_aggregator_generations_last_hour Generation results created in the last hour.",
    "# TYPE ai_aggregator_generations_last_hour gauge",
    ...snapshot.generations.map(
      (row) =>
        `ai_aggregator_generations_last_hour${labels({ module: row.module, status: row.status })} ${row.count}`,
    ),
    "# HELP ai_aggregator_generation_duration_seconds_last_hour Average generation duration in the last hour.",
    "# TYPE ai_aggregator_generation_duration_seconds_last_hour gauge",
    ...snapshot.generations
      .filter((row) => row.averageDurationMs !== null)
      .map(
        (row) =>
          `ai_aggregator_generation_duration_seconds_last_hour${labels({ module: row.module, status: row.status })} ${row.averageDurationMs! / 1000}`,
      ),
    "# HELP ai_aggregator_ppt_status_updates_last_hour PPT projects updated in the last hour.",
    "# TYPE ai_aggregator_ppt_status_updates_last_hour gauge",
    ...snapshot.pptStatuses.map(
      (row) =>
        `ai_aggregator_ppt_status_updates_last_hour${labels({ status: row.status })} ${row.count}`,
    ),
    "# HELP ai_aggregator_ppt_pending_refunds Failed PPT projects still awaiting a credit refund.",
    "# TYPE ai_aggregator_ppt_pending_refunds gauge",
    `ai_aggregator_ppt_pending_refunds ${snapshot.pendingPptRefunds}`,
    "# TYPE ai_aggregator_users gauge",
    `ai_aggregator_users ${snapshot.users}`,
    "# TYPE ai_aggregator_material_bytes gauge",
    `ai_aggregator_material_bytes ${snapshot.materialBytes}`,
    "# TYPE ai_aggregator_rate_limit_buckets gauge",
    `ai_aggregator_rate_limit_buckets ${snapshot.rateLimitBuckets}`,
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${snapshot.process.uptimeSeconds}`,
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${snapshot.process.rssBytes}`,
    "# TYPE process_heap_bytes gauge",
    `process_heap_bytes ${snapshot.process.heapUsedBytes}`,
  ];
  if (snapshot.filesystem) {
    lines.push(
      "# TYPE ai_aggregator_filesystem_bytes gauge",
      `ai_aggregator_filesystem_bytes${labels({ state: "total" })} ${snapshot.filesystem.totalBytes}`,
      `ai_aggregator_filesystem_bytes${labels({ state: "available" })} ${snapshot.filesystem.availableBytes}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
