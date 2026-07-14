#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import {
  DEFAULT_PRODUCTION_HEALTH_THRESHOLDS,
  evaluateComposeServices,
  evaluateProductionMetrics,
  parseComposePsJson,
  parsePrometheusMetrics,
  type ProductionHealthIssue,
} from "../src/lib/production-health";

const args = process.argv.slice(2);
const skipDocker = takeFlag("--skip-docker");
const envFile = resolve(
  takeOption("--env-file") ||
    process.env.PRODUCTION_ENV_FILE?.trim() ||
    ".env.production",
);
const explicitBaseUrl = takeOption("--base-url");
if (args.length > 0) {
  throw new Error(`Unknown production health option: ${args[0]}`);
}

if (!existsSync(envFile)) {
  throw new Error(`Production environment file not found: ${envFile}`);
}
loadEnvFile(envFile);

const baseUrl = new URL(
  explicitBaseUrl || process.env.APP_URL || process.env.AUTH_URL || "",
);
if (!/^https?:$/.test(baseUrl.protocol)) {
  throw new Error("APP_URL must use http or https.");
}
const metricsToken = process.env.METRICS_TOKEN?.trim();
if (!metricsToken) throw new Error("METRICS_TOKEN is required.");
const timeoutMs = integerEnvironment("PROD_HEALTH_HTTP_TIMEOUT_MS", 10_000, {
  min: 1_000,
  max: 60_000,
});
const thresholds = {
  minDiskAvailableRatio:
    numberEnvironment("PROD_HEALTH_MIN_DISK_AVAILABLE_PERCENT", 15, {
      min: 0.1,
      max: 99,
    }) / 100,
  maxDatabaseQuerySeconds: numberEnvironment(
    "PROD_HEALTH_MAX_DB_QUERY_SECONDS",
    DEFAULT_PRODUCTION_HEALTH_THRESHOLDS.maxDatabaseQuerySeconds,
    { min: 0.01, max: 60 },
  ),
  maxDatabaseConnectionUtilizationRatio:
    numberEnvironment(
      "PROD_HEALTH_MAX_DB_CONNECTION_UTILIZATION_PERCENT",
      DEFAULT_PRODUCTION_HEALTH_THRESHOLDS.maxDatabaseConnectionUtilizationRatio *
        100,
      { min: 1, max: 100 },
    ) / 100,
  maxImageQueueAgeSeconds: integerEnvironment(
    "PROD_HEALTH_MAX_IMAGE_QUEUE_AGE_SECONDS",
    DEFAULT_PRODUCTION_HEALTH_THRESHOLDS.maxImageQueueAgeSeconds,
    { min: 1 },
  ),
  maxPptQueueAgeSeconds: integerEnvironment(
    "PROD_HEALTH_MAX_PPT_QUEUE_AGE_SECONDS",
    DEFAULT_PRODUCTION_HEALTH_THRESHOLDS.maxPptQueueAgeSeconds,
    { min: 1 },
  ),
  maxQueueUtilizationRatio:
    numberEnvironment("PROD_HEALTH_MAX_QUEUE_UTILIZATION_PERCENT", 90, {
      min: 1,
      max: 100,
    }) / 100,
  maxPendingPptRefunds: integerEnvironment(
    "PROD_HEALTH_MAX_PENDING_PPT_REFUNDS",
    DEFAULT_PRODUCTION_HEALTH_THRESHOLDS.maxPendingPptRefunds,
    { min: 0 },
  ),
};

void main().catch((error) => {
  console.error(
    `Production health check failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

async function main() {
  const issues: ProductionHealthIssue[] = [];
  if (!skipDocker) {
    const projectName =
      process.env.COMPOSE_PROJECT_NAME?.trim() || "ai-aggregator";
    const output = execFileSync(
      "docker",
      ["compose", "-p", projectName, "ps", "--all", "--format", "json"],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );
    issues.push(...evaluateComposeServices(parseComposePsJson(output)));
  }

  const [live, ready, metrics] = await Promise.all([
    fetchBody("/api/health/live"),
    fetchBody("/api/health/ready"),
    fetchBody("/api/health/metrics", {
      Authorization: `Bearer ${metricsToken}`,
    }),
  ]);
  assertJsonStatus(live, "ok", "liveness");
  assertJsonStatus(ready, "ready", "readiness");
  issues.push(
    ...evaluateProductionMetrics(parsePrometheusMetrics(metrics), thresholds),
  );

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`FAIL ${issue.code}: ${issue.message}`);
    }
    console.error(
      `Production health check failed with ${issues.length} issue(s).`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Production health check passed for ${baseUrl.origin}${skipDocker ? " (Docker check skipped)" : ""}.`,
    );
  }
}

function takeFlag(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function takeOption(name: string) {
  const inlineIndex = args.findIndex((arg) => arg.startsWith(`${name}=`));
  if (inlineIndex >= 0) {
    return args.splice(inlineIndex, 1)[0]!.slice(name.length + 1);
  }
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  args.splice(index, 2);
  return value;
}

function numberEnvironment(
  name: string,
  fallback: number,
  bounds: { min: number; max?: number },
) {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  const value = Number(configured);
  const max = bounds.max ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isFinite(value) || value < bounds.min || value > max) {
    throw new Error(`${name} must be from ${bounds.min} to ${max}.`);
  }
  return value;
}

function integerEnvironment(
  name: string,
  fallback: number,
  bounds: { min: number; max?: number },
) {
  const value = numberEnvironment(name, fallback, bounds);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}

async function fetchBody(path: string, headers?: HeadersInit) {
  const response = await fetch(new URL(path, baseUrl), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
  return body;
}

function assertJsonStatus(body: string, expected: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`${label} endpoint returned invalid JSON.`);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("status" in parsed) ||
    parsed.status !== expected
  ) {
    throw new Error(`${label} endpoint returned an unexpected status.`);
  }
}
