#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const envFile = resolve(
  process.env.PRODUCTION_ENV_FILE?.trim() || ".env.production",
);
const projectName =
  process.env.COMPOSE_PROJECT_NAME?.trim() || "ai-aggregator";

if (args.length === 0) {
  console.error(
    "Usage: npm run prod:compose -- <docker compose arguments>",
  );
  process.exit(2);
}

if (!existsSync(envFile)) {
  console.error(`Production environment file not found: ${envFile}`);
  process.exit(1);
}

try {
  loadEnvFile(envFile);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to load production environment: ${message}`);
  process.exit(1);
}

const result = spawnSync(
  "docker",
  ["compose", "-p", projectName, ...args],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`Unable to run Docker Compose: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
