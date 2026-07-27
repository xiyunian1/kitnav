import { describe, expect, it } from "vitest";
import {
  type OperationalMetricsSnapshot,
  renderOperationalMetrics,
} from "./operational-metrics";

function snapshot(
  overrides: Partial<OperationalMetricsSnapshot> = {},
): OperationalMetricsSnapshot {
  return {
    collectedAt: Date.parse("2026-07-11T12:00:00.000Z"),
    databaseQueryDurationMs: 250,
    databaseConnections: { used: 12, max: 100 },
    imageQueue: {
      queued: 3,
      running: 1,
      stale: 1,
      capacity: 10,
      oldestCreatedAt: new Date("2026-07-11T11:58:30.000Z"),
    },
    pptQueue: {
      queued: 2,
      running: 1,
      stale: 0,
      capacity: 30,
      oldestCreatedAt: null,
    },
    generations: [
      {
        module: "IMAGE",
        status: "SUCCESS",
        count: 4,
        averageDurationMs: 1_500,
      },
    ],
    pptStatuses: [{ status: "COMPLETED", count: 2 }],
    pendingPptRefunds: 1,
    users: 10,
    materialBytes: 2_048,
    rateLimitBuckets: 5,
    redis: { configured: true, healthy: true, latencyMs: 2 },
    filesystem: { totalBytes: 10_000, availableBytes: 4_000 },
    process: { uptimeSeconds: 60, rssBytes: 3_000, heapUsedBytes: 1_000 },
    ...overrides,
  };
}

describe("renderOperationalMetrics", () => {
  it("renders queue ages, durations, and filesystem values in Prometheus format", () => {
    const output = renderOperationalMetrics(snapshot());

    expect(output).toContain(
      'ai_aggregator_queue_oldest_age_seconds{queue="image"} 90',
    );
    expect(output).toContain(
      'ai_aggregator_queue_oldest_age_seconds{queue="ppt"} 0',
    );
    expect(output).toContain(
      'ai_aggregator_queue_jobs{queue="image",state="stale"} 1',
    );
    expect(output).toContain(
      'ai_aggregator_queue_capacity{queue="image"} 10',
    );
    expect(output).toContain(
      'ai_aggregator_queue_utilization_ratio{queue="image"} 0.5',
    );
    expect(output).toContain(
      'ai_aggregator_generation_duration_seconds_last_hour{module="IMAGE",status="SUCCESS"} 1.5',
    );
    expect(output).toContain(
      'ai_aggregator_filesystem_bytes{state="available"} 4000',
    );
    expect(output).toContain(
      'ai_aggregator_database_connections{state="used"} 12',
    );
    expect(output).toContain(
      'ai_aggregator_database_connections{state="max"} 100',
    );
    expect(output).toContain("ai_aggregator_ppt_pending_refunds 1");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("escapes label values and omits unavailable optional metrics", () => {
    const output = renderOperationalMetrics(
      snapshot({
        filesystem: null,
        generations: [
          {
            module: 'IM"AGE\\line\nnext',
            status: "FAILED",
            count: 1,
            averageDurationMs: null,
          },
        ],
      }),
    );

    expect(output).toContain(
      'module="IM\\"AGE\\\\line\\nnext",status="FAILED"',
    );
    expect(output).not.toContain("ai_aggregator_filesystem_bytes");
    expect(output).not.toContain(
      "ai_aggregator_generation_duration_seconds_last_hour{",
    );
  });
});
