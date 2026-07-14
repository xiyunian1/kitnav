export interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface ProductionHealthThresholds {
  minDiskAvailableRatio: number;
  maxDatabaseQuerySeconds: number;
  maxDatabaseConnectionUtilizationRatio: number;
  maxImageQueueAgeSeconds: number;
  maxPptQueueAgeSeconds: number;
  maxQueueUtilizationRatio: number;
  maxPendingPptRefunds: number;
}

export interface ProductionHealthIssue {
  code: string;
  message: string;
}

export interface ComposeServiceState {
  Service?: string;
  State?: string;
  Health?: string;
}

export const DEFAULT_PRODUCTION_HEALTH_THRESHOLDS = {
  minDiskAvailableRatio: 0.15,
  maxDatabaseQuerySeconds: 2,
  maxDatabaseConnectionUtilizationRatio: 0.8,
  maxImageQueueAgeSeconds: 30 * 60,
  maxPptQueueAgeSeconds: 150 * 60,
  maxQueueUtilizationRatio: 0.9,
  maxPendingPptRefunds: 0,
} satisfies ProductionHealthThresholds;

const METRIC_LINE =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+([^\s]+)(?:\s+\d+)?$/;

export function parsePrometheusMetrics(text: string): PrometheusSample[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = METRIC_LINE.exec(line);
      if (!match) throw new Error(`Invalid Prometheus metric line: ${line}`);
      const value = Number(match[3]);
      if (!Number.isFinite(value)) {
        throw new Error(`Non-finite Prometheus metric value: ${line}`);
      }
      return {
        name: match[1],
        labels: parseLabels(match[2]),
        value,
      };
    });
}

function parseLabels(raw: string | undefined) {
  const labels: Record<string, string> = {};
  if (raw === undefined || raw.trim() === "") return labels;

  let cursor = 0;
  while (cursor < raw.length) {
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    const key = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(raw.slice(cursor))?.[0];
    if (!key) throw new Error(`Invalid Prometheus labels: ${raw}`);
    cursor += key.length;
    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    if (raw.slice(cursor, cursor + 2) !== '=\"') {
      throw new Error(`Invalid Prometheus labels: ${raw}`);
    }
    cursor += 2;

    let value = "";
    let closed = false;
    while (cursor < raw.length) {
      const character = raw[cursor];
      cursor += 1;
      if (character === '"') {
        closed = true;
        break;
      }
      if (character !== "\\") {
        value += character;
        continue;
      }
      const escaped = raw[cursor];
      cursor += 1;
      if (escaped === "n") value += "\n";
      else if (escaped === "\\" || escaped === '"') value += escaped;
      else throw new Error(`Invalid Prometheus label escape: ${raw}`);
    }
    if (!closed || Object.hasOwn(labels, key)) {
      throw new Error(`Invalid Prometheus labels: ${raw}`);
    }
    labels[key] = value;

    while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
    if (cursor === raw.length) break;
    if (raw[cursor] !== ",") {
      throw new Error(`Invalid Prometheus labels: ${raw}`);
    }
    cursor += 1;
    if (cursor === raw.length) {
      throw new Error(`Invalid Prometheus labels: ${raw}`);
    }
  }
  return labels;
}

function findMetric(
  samples: PrometheusSample[],
  name: string,
  expectedLabels: Record<string, string> = {},
) {
  const matches = samples.filter(
    (sample) =>
      sample.name === name &&
      Object.entries(expectedLabels).every(
        ([key, value]) => sample.labels[key] === value,
      ),
  );
  return matches.length === 1 ? matches[0]!.value : null;
}

export function evaluateProductionMetrics(
  samples: PrometheusSample[],
  thresholds: ProductionHealthThresholds = DEFAULT_PRODUCTION_HEALTH_THRESHOLDS,
) {
  const issues: ProductionHealthIssue[] = [];
  const required = (
    name: string,
    labels: Record<string, string> = {},
  ) => {
    const value = findMetric(samples, name, labels);
    if (value === null) {
      const suffix = Object.keys(labels).length
        ? ` ${JSON.stringify(labels)}`
        : "";
      issues.push({
        code: "metric-missing",
        message: `Required metric ${name}${suffix} is missing or duplicated.`,
      });
    }
    return value;
  };

  const up = required("ai_aggregator_up");
  if (up !== null && up !== 1) {
    issues.push({ code: "application-down", message: `Application up=${up}.` });
  }

  const databaseDuration = required(
    "ai_aggregator_database_query_duration_seconds",
  );
  if (
    databaseDuration !== null &&
    databaseDuration > thresholds.maxDatabaseQuerySeconds
  ) {
    issues.push({
      code: "database-slow",
      message: `Database metrics query took ${databaseDuration}s (limit ${thresholds.maxDatabaseQuerySeconds}s).`,
    });
  }

  const usedDatabaseConnections = required(
    "ai_aggregator_database_connections",
    { state: "used" },
  );
  const maxDatabaseConnections = required(
    "ai_aggregator_database_connections",
    { state: "max" },
  );
  if (
    usedDatabaseConnections !== null &&
    maxDatabaseConnections !== null
  ) {
    if (usedDatabaseConnections < 0 || maxDatabaseConnections <= 0) {
      issues.push({
        code: "database-connections-invalid",
        message: "Database connection metrics contain invalid values.",
      });
    } else {
      const utilization = usedDatabaseConnections / maxDatabaseConnections;
      if (
        utilization >= thresholds.maxDatabaseConnectionUtilizationRatio
      ) {
        issues.push({
          code: "database-connections-high",
          message: `Database connections are ${(utilization * 100).toFixed(1)}% utilized (${usedDatabaseConnections}/${maxDatabaseConnections}, alert threshold ${(thresholds.maxDatabaseConnectionUtilizationRatio * 100).toFixed(1)}%).`,
        });
      }
    }
  }

  for (const queue of ["image", "ppt"] as const) {
    const stale = required("ai_aggregator_queue_jobs", {
      queue,
      state: "stale",
    });
    if (stale !== null && stale > 0) {
      issues.push({
        code: `${queue}-queue-stale`,
        message: `${queue} queue has ${stale} stale job(s).`,
      });
    }

    const age = required("ai_aggregator_queue_oldest_age_seconds", { queue });
    const maxAge =
      queue === "image"
        ? thresholds.maxImageQueueAgeSeconds
        : thresholds.maxPptQueueAgeSeconds;
    if (age !== null && age > maxAge) {
      issues.push({
        code: `${queue}-queue-oldest`,
        message: `${queue} queue oldest job is ${age}s old (limit ${maxAge}s).`,
      });
    }

    const utilization = required("ai_aggregator_queue_utilization_ratio", {
      queue,
    });
    if (
      utilization !== null &&
      utilization >= thresholds.maxQueueUtilizationRatio
    ) {
      issues.push({
        code: `${queue}-queue-capacity`,
        message: `${queue} queue is ${(utilization * 100).toFixed(1)}% full (alert threshold ${(thresholds.maxQueueUtilizationRatio * 100).toFixed(1)}%).`,
      });
    }
  }

  const pendingRefunds = required("ai_aggregator_ppt_pending_refunds");
  if (
    pendingRefunds !== null &&
    pendingRefunds > thresholds.maxPendingPptRefunds
  ) {
    issues.push({
      code: "ppt-refunds-pending",
      message: `${pendingRefunds} PPT refund(s) are pending (limit ${thresholds.maxPendingPptRefunds}).`,
    });
  }

  const totalBytes = required("ai_aggregator_filesystem_bytes", {
    state: "total",
  });
  const availableBytes = required("ai_aggregator_filesystem_bytes", {
    state: "available",
  });
  if (totalBytes !== null && availableBytes !== null) {
    if (totalBytes <= 0 || availableBytes < 0) {
      issues.push({
        code: "filesystem-invalid",
        message: "Filesystem metrics contain invalid byte counts.",
      });
    } else {
      const ratio = availableBytes / totalBytes;
      if (ratio < thresholds.minDiskAvailableRatio) {
        issues.push({
          code: "filesystem-low",
          message: `Filesystem has ${(ratio * 100).toFixed(1)}% available (minimum ${(thresholds.minDiskAvailableRatio * 100).toFixed(1)}%).`,
        });
      }
    }
  }

  return issues;
}

export function parseComposePsJson(text: string): ComposeServiceState[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter(isComposeServiceState);
  } catch {
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isComposeServiceState);
  }
}

function isComposeServiceState(value: unknown): value is ComposeServiceState {
  return typeof value === "object" && value !== null;
}

export function evaluateComposeServices(
  services: ComposeServiceState[],
  expectedServices = ["postgres", "app", "image-worker", "ppt-worker", "caddy"],
) {
  const issues: ProductionHealthIssue[] = [];
  const byName = new Map(
    services
      .filter((service) => typeof service.Service === "string")
      .map((service) => [service.Service!, service]),
  );
  for (const name of expectedServices) {
    const service = byName.get(name);
    if (!service) {
      issues.push({
        code: "service-missing",
        message: `Compose service ${name} is missing.`,
      });
      continue;
    }
    if (service.State?.toLowerCase() !== "running") {
      issues.push({
        code: "service-not-running",
        message: `Compose service ${name} is ${service.State ?? "unknown"}.`,
      });
    }
    if (service.Health && service.Health.toLowerCase() !== "healthy") {
      issues.push({
        code: "service-unhealthy",
        message: `Compose service ${name} health is ${service.Health}.`,
      });
    }
  }
  return issues;
}
