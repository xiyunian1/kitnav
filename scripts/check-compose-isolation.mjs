#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const root = resolve(import.meta.dirname, "..");
const examplePath = resolve(root, ".env.production.example");
const exampleEnvironment = parseEnv(readFileSync(examplePath, "utf8"));
const composeEnvironment = { ...process.env };

for (const name of Object.keys(exampleEnvironment)) {
  delete composeEnvironment[name];
}
Object.assign(composeEnvironment, exampleEnvironment);

const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    examplePath,
    "-p",
    "ai-aggregator",
    "config",
    "--format",
    "json",
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: composeEnvironment,
  },
);

if (result.error) {
  console.error(`Unable to inspect Docker Compose: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(result.stderr.trim() || "Docker Compose config failed.");
  process.exit(result.status ?? 1);
}

let config;
try {
  config = JSON.parse(result.stdout);
} catch {
  console.error("Docker Compose returned invalid JSON.");
  process.exit(1);
}

const expectedNetworks = {
  postgres: ["backend"],
  app: ["backend", "edge"],
  "image-worker": ["backend"],
  "ppt-worker": ["backend"],
  caddy: ["edge"],
};

const expectedEnvironment = {
  postgres: ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"],
  app: [
    "API_TEST_RATE_MAX",
    "API_TEST_RATE_WINDOW_MS",
    "APP_URL",
    "AUTH_LOGIN_ACCOUNT_RATE_MAX",
    "AUTH_LOGIN_ACCOUNT_RATE_WINDOW_MS",
    "AUTH_LOGIN_RATE_MAX",
    "AUTH_LOGIN_RATE_WINDOW_MS",
    "AUTH_SECRET",
    "AUTH_TRUST_HOST",
    "AUTH_URL",
    "DATABASE_URL",
    "DATABASE_CONNECTION_LIMIT",
    "DATABASE_POOL_TIMEOUT_SECONDS",
    "DB_SCHEMA_SYNC",
    "ENCRYPTION_KEY",
    "FEEDBACK_UPLOAD_ROOT",
    "FEEDBACK_USER_MAX_FILES",
    "FEEDBACK_USER_QUOTA_BYTES",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "IMAGE_CANCEL_RATE_MAX",
    "IMAGE_CANCEL_RATE_WINDOW_MS",
    "IMAGE_CONVERSATION_WRITE_RATE_MAX",
    "IMAGE_CONVERSATION_WRITE_RATE_WINDOW_MS",
    "IMAGE_GENERATE_RATE_MAX",
    "IMAGE_GENERATE_RATE_WINDOW_MS",
    "IMAGE_GLOBAL_MAX_PENDING",
    "IMAGE_INPUT_ROOT",
    "LINUX_DO_AUTHORIZATION_ENDPOINT",
    "LINUX_DO_CLIENT_ID",
    "LINUX_DO_CLIENT_SECRET",
    "LINUX_DO_CREDIT_GATEWAY",
    "LINUX_DO_CREDIT_KEY",
    "LINUX_DO_CREDIT_NOTIFY_IP_ALLOWLIST",
    "LINUX_DO_CREDIT_PID",
    "LINUX_DO_ISSUER",
    "LINUX_DO_TOKEN_ENDPOINT",
    "LINUX_DO_USER_ENDPOINT",
    "LOG_LEVEL",
    "MATERIAL_REPORT_RATE_MAX",
    "MATERIAL_REPORT_RATE_WINDOW_MS",
    "MATERIAL_SAVE_RATE_MAX",
    "MATERIAL_SAVE_RATE_WINDOW_MS",
    "MATERIAL_UPLOAD_RATE_MAX",
    "MATERIAL_UPLOAD_RATE_WINDOW_MS",
    "MATERIAL_UPLOAD_ROOT",
    "MATERIAL_USER_MAX_FILES",
    "MATERIAL_USER_QUOTA_BYTES",
    "METRICS_TOKEN",
    "NEXT_PUBLIC_ICP",
    "NEXT_PUBLIC_SITE_URL",
    "NO_PROXY",
    "PASSWORD_CHANGE_RATE_MAX",
    "PASSWORD_CHANGE_RATE_WINDOW_MS",
    "PPT_CREDITS_PER_SLIDE",
    "PPT_GENERATE_RATE_MAX",
    "PPT_GENERATE_RATE_WINDOW_MS",
    "PPT_GLOBAL_MAX_PENDING",
    "PPT_PROJECTS_ROOT",
    "PPT_UPLOAD_MAX_BYTES",
    "PPT_UPLOAD_RATE_MAX",
    "PPT_UPLOAD_RATE_WINDOW_MS",
    "PPT_UPLOAD_ROOT",
    "PPT_UPLOAD_USER_MAX_FILES",
    "PPT_UPLOAD_USER_QUOTA_BYTES",
    "PROMPT_OPTIMIZE_RATE_MAX",
    "PROMPT_OPTIMIZE_RATE_WINDOW_MS",
    "RECHARGE_PROVIDER",
    "RECHARGE_RATE_MAX",
    "RECHARGE_RATE_WINDOW_MS",
    "REGISTER_RATE_MAX",
    "REGISTER_RATE_WINDOW_MS",
    "UPLOAD_STORAGE_ROOT",
    "XDG_CACHE_HOME",
  ],
  "image-worker": [
    "DATABASE_URL",
    "DATABASE_CONNECTION_LIMIT",
    "DATABASE_POOL_TIMEOUT_SECONDS",
    "DB_SCHEMA_SYNC",
    "ENCRYPTION_KEY",
    "FEEDBACK_UPLOAD_ROOT",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "IMAGE_INPUT_RETENTION_HOURS",
    "IMAGE_INPUT_ROOT",
    "IMAGE_INPUT_SWEEP_MS",
    "IMAGE_UPSTREAM_MAX_ATTEMPTS",
    "IMAGE_USER_MAX_PENDING",
    "IMAGE_WORKER_CONCURRENCY",
    "IMAGE_WORKER_HEALTH_MAX_AGE_MS",
    "IMAGE_WORKER_HEARTBEAT_MS",
    "IMAGE_WORKER_MAX_ATTEMPTS",
    "IMAGE_WORKER_POLL_MS",
    "IMAGE_WORKER_READY_FILE",
    "IMAGE_WORKER_SWEEP_MS",
    "LOG_LEVEL",
    "MATERIAL_UPLOAD_ROOT",
    "MATERIAL_USER_MAX_FILES",
    "MATERIAL_USER_QUOTA_BYTES",
    "NO_PROXY",
    "UPLOAD_ORPHAN_RETENTION_HOURS",
    "UPLOAD_STORAGE_ROOT",
    "UPLOAD_STORAGE_SWEEP_MS",
    "UPLOAD_STORAGE_SWEEP_TIMEOUT_MS",
    "XDG_CACHE_HOME",
  ],
  "ppt-worker": [
    "DATABASE_URL",
    "DATABASE_CONNECTION_LIMIT",
    "DATABASE_POOL_TIMEOUT_SECONDS",
    "DB_SCHEMA_SYNC",
    "ENCRYPTION_KEY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "LOG_LEVEL",
    "MPLCONFIGDIR",
    "NO_PROXY",
    "PPT_AGENT_INLINE_CONTEXT",
    "PPT_AGENT_INLINE_CONTEXT_MAX_BYTES",
    "PPT_AGENT_KEEP_LIVE_PREVIEW",
    "PPT_AGENT_MAX_CONCURRENT",
    "PPT_AGENT_MAX_TURNS",
    "PPT_AGENT_NO_ARTIFACT_TIMEOUT_MS",
    "PPT_AGENT_TIMEOUT_MS",
    "PPT_EXECUTOR_MAX_NO_PROGRESS_TURNS",
    "PPT_TEMPLATE_MAX_NO_PROGRESS_TURNS",
    "PPT_ARCHIVE_EXTRACTOR",
    "PPT_EXTERNAL_TEMPLATE_MAX_BYTES",
    "PPT_ORPHAN_PROJECT_RETENTION_HOURS",
    "PPT_PI_API_TYPE",
    "PPT_PI_CONTEXT_WINDOW",
    "PPT_PI_MAX_TOKENS",
    "PPT_PI_MAX_TOKENS_FIELD",
    "PPT_PI_PROVIDER",
    "PPT_PI_REASONING",
    "PPT_PI_SUPPORTS_DEVELOPER_ROLE",
    "PPT_PI_SUPPORTS_REASONING_EFFORT",
    "PPT_PI_SUPPORTS_STORE",
    "PPT_PI_SUPPORTS_USAGE_IN_STREAMING",
    "PPT_PI_THINKING",
    "PPT_PI_THINKING_VALUE",
    "PPT_PI_USER_AGENT",
    "PPT_PROJECTS_ROOT",
    "PPT_PYTHON_CMD",
    "PPT_STALE_ACTIVE_PROJECT_MS",
    "PPT_STORAGE_SWEEP_ENABLED",
    "PPT_STORAGE_SWEEP_MS",
    "PPT_STORAGE_SWEEP_TIMEOUT_MS",
    "PPT_UPLOAD_RETENTION_HOURS",
    "PPT_UPLOAD_ROOT",
    "PPT_WORKER_HEALTH_MAX_AGE_MS",
    "PPT_WORKER_HEARTBEAT_MS",
    "PPT_WORKER_POLL_MS",
    "PPT_WORKER_READY_FILE",
    "PPT_WORKER_SWEEP_MS",
    "XDG_CACHE_HOME",
  ],
  caddy: [],
};

function sorted(values) {
  return [...values].sort();
}

function assertEqual(label, actual, expected) {
  const actualJson = JSON.stringify(sorted(actual));
  const expectedJson = JSON.stringify(sorted(expected));
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, received ${actualJson}`);
  }
}

const expectedCapabilities = {
  postgres: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],
  app: ["CHOWN", "KILL", "SETGID", "SETUID"],
  "image-worker": ["CHOWN", "KILL", "SETGID", "SETUID"],
  "ppt-worker": ["CHOWN", "KILL", "SETGID", "SETUID"],
  caddy: ["NET_BIND_SERVICE"],
};

try {
  const serviceNames = Object.keys(config.services ?? {});
  assertEqual("services", serviceNames, Object.keys(expectedNetworks));

  for (const serviceName of serviceNames) {
    const service = config.services[serviceName];
    assertEqual(
      `${serviceName} networks`,
      Object.keys(service.networks ?? {}),
      expectedNetworks[serviceName],
    );
    assertEqual(
      `${serviceName} environment`,
      Object.keys(service.environment ?? {}),
      expectedEnvironment[serviceName],
    );
    if (service.read_only !== true) {
      throw new Error(`${serviceName} root filesystem must be read-only.`);
    }
    assertEqual(`${serviceName} cap_drop`, service.cap_drop ?? [], ["ALL"]);
    assertEqual(
      `${serviceName} cap_add`,
      service.cap_add ?? [],
      expectedCapabilities[serviceName],
    );
    assertEqual(`${serviceName} security_opt`, service.security_opt ?? [], [
      "no-new-privileges:true",
    ]);
    if (!service.pids_limit || !service.mem_limit || !service.cpus) {
      throw new Error(`${serviceName} CPU, memory, and PID limits are required.`);
    }
    if (
      service.logging?.driver !== "json-file" ||
      !service.logging?.options?.["max-size"] ||
      !service.logging?.options?.["max-file"]
    ) {
      throw new Error(`${serviceName} must use bounded json-file logging.`);
    }

    if (serviceName !== "caddy" && (service.ports?.length ?? 0) !== 0) {
      throw new Error(`${serviceName} must not publish host ports.`);
    }
  }

  const caddyPorts = (config.services.caddy.ports ?? []).map(
    ({ published, target }) => `${published}:${target}`,
  );
  assertEqual("caddy ports", caddyPorts, ["80:80", "443:443"]);
  if (config.services.caddy.pids_limit !== 128) {
    throw new Error("caddy pids_limit must be 128.");
  }
  const postgresCommand = config.services.postgres.command ?? [];
  if (!postgresCommand.includes("max_connections=100")) {
    throw new Error("postgres max_connections must be explicitly bounded.");
  }
  const expectedPoolLimits = {
    app: "10",
    "image-worker": "5",
    "ppt-worker": "5",
  };
  for (const [serviceName, expectedLimit] of Object.entries(
    expectedPoolLimits,
  )) {
    const environment = config.services[serviceName].environment;
    if (environment.DATABASE_CONNECTION_LIMIT !== expectedLimit) {
      throw new Error(
        `${serviceName} DATABASE_CONNECTION_LIMIT must be ${expectedLimit}.`,
      );
    }
    if (environment.DATABASE_POOL_TIMEOUT_SECONDS !== "10") {
      throw new Error(
        `${serviceName} DATABASE_POOL_TIMEOUT_SECONDS must be 10.`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(
  "Compose network, port, environment, resource, and logging isolation checks passed.",
);
