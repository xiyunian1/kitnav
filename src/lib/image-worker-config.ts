import { boundedIntegerEnv } from "@/lib/runtime-config";

export const IMAGE_WORKER_STALE_TIMEOUT_MS = 10 * 60 * 1000;

type Environment = Readonly<Record<string, string | undefined>>;

export function getImageWorkerConcurrency(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("IMAGE_WORKER_CONCURRENCY", 2, {
    min: 1,
    max: 10,
    environment,
  });
}

export function getImageUserMaxPending(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("IMAGE_USER_MAX_PENDING", 3, {
    min: 1,
    max: 100,
    environment,
  });
}

export function getImageUpstreamMaxAttempts(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("IMAGE_UPSTREAM_MAX_ATTEMPTS", 2, {
    min: 1,
    max: 10,
    environment,
  });
}

export function getImageWorkerMaxAttempts(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("IMAGE_WORKER_MAX_ATTEMPTS", 3, {
    min: 1,
    max: 10,
    environment,
  });
}

export function getImageInputRetentionMs(
  environment: Environment = process.env,
) {
  const hours = boundedIntegerEnv("IMAGE_INPUT_RETENTION_HOURS", 24, {
    min: 1,
    max: 24 * 365,
    environment,
  });
  return hours * 60 * 60 * 1000;
}
