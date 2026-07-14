import { describe, expect, it } from "vitest";
import {
  evaluateComposeServices,
  evaluateProductionMetrics,
  parseComposePsJson,
  parsePrometheusMetrics,
} from "./production-health";

const HEALTHY_METRICS = `
# TYPE ai_aggregator_up gauge
ai_aggregator_up 1
ai_aggregator_database_query_duration_seconds 0.25
ai_aggregator_database_connections{state="used"} 12
ai_aggregator_database_connections{state="max"} 100
ai_aggregator_queue_jobs{queue="image",state="stale"} 0
ai_aggregator_queue_jobs{queue="ppt",state="stale"} 0
ai_aggregator_queue_oldest_age_seconds{queue="image"} 120
ai_aggregator_queue_oldest_age_seconds{queue="ppt"} 300
ai_aggregator_queue_utilization_ratio{queue="image"} 0.05
ai_aggregator_queue_utilization_ratio{queue="ppt"} 0.1
ai_aggregator_ppt_pending_refunds 0
ai_aggregator_filesystem_bytes{state="total"} 10000
ai_aggregator_filesystem_bytes{state="available"} 4000
`;

describe("production health metrics", () => {
  it("parses labels and accepts healthy metrics", () => {
    const samples = parsePrometheusMetrics(
      `${HEALTHY_METRICS}custom_metric{value="quoted\\\" slash\\\\ line\\nnext"} 2\n`,
    );

    expect(samples.at(-1)).toEqual({
      name: "custom_metric",
      labels: { value: 'quoted" slash\\ line\nnext' },
      value: 2,
    });
    expect(evaluateProductionMetrics(samples)).toEqual([]);
  });

  it("reports stale work, slow queries, refunds, queue age, and low disk", () => {
    const metrics = HEALTHY_METRICS
      .replace(" 0.25", " 3")
      .replace('state="used"} 12', 'state="used"} 85')
      .replace('queue="image",state="stale"} 0', 'queue="image",state="stale"} 2')
      .replace('queue="image"} 0.05', 'queue="image"} 0.95')
      .replace('queue="ppt"} 300', 'queue="ppt"} 10000')
      .replace("pending_refunds 0", "pending_refunds 1")
      .replace('state="available"} 4000', 'state="available"} 1000');

    expect(
      evaluateProductionMetrics(parsePrometheusMetrics(metrics)).map(
        (issue) => issue.code,
      ),
    ).toEqual([
      "database-slow",
      "database-connections-high",
      "image-queue-stale",
      "image-queue-capacity",
      "ppt-queue-oldest",
      "ppt-refunds-pending",
      "filesystem-low",
    ]);
  });

  it("rejects malformed or missing metrics", () => {
    expect(() => parsePrometheusMetrics("bad metric line")).toThrow(
      "Invalid Prometheus metric line",
    );
    expect(evaluateProductionMetrics([])).toHaveLength(13);
  });
});

describe("production Compose health", () => {
  it("accepts running, healthy services from Compose JSON", () => {
    const services = parseComposePsJson(
      JSON.stringify([
        { Service: "postgres", State: "running", Health: "healthy" },
        { Service: "app", State: "running", Health: "healthy" },
        { Service: "image-worker", State: "running", Health: "healthy" },
        { Service: "ppt-worker", State: "running", Health: "healthy" },
        { Service: "caddy", State: "running", Health: "" },
      ]),
    );

    expect(evaluateComposeServices(services)).toEqual([]);
  });

  it("reports missing, stopped, or unhealthy services", () => {
    const services = parseComposePsJson(
      '{"Service":"postgres","State":"running","Health":"healthy"}\n' +
        '{"Service":"app","State":"exited","Health":"unhealthy"}\n',
    );

    expect(evaluateComposeServices(services).map((issue) => issue.code)).toEqual([
      "service-not-running",
      "service-unhealthy",
      "service-missing",
      "service-missing",
      "service-missing",
    ]);
  });
});
