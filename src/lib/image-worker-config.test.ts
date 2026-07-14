import { describe, expect, it } from "vitest";
import {
  getImageInputRetentionMs,
  getImageUpstreamMaxAttempts,
  getImageUserMaxPending,
  getImageWorkerConcurrency,
  getImageWorkerMaxAttempts,
} from "./image-worker-config";

describe("image worker runtime configuration", () => {
  it("accepts values inside the operational bounds", () => {
    const environment = {
      IMAGE_WORKER_CONCURRENCY: "6",
      IMAGE_USER_MAX_PENDING: "20",
      IMAGE_UPSTREAM_MAX_ATTEMPTS: "4",
      IMAGE_WORKER_MAX_ATTEMPTS: "5",
      IMAGE_INPUT_RETENTION_HOURS: "48",
    };

    expect(getImageWorkerConcurrency(environment)).toBe(6);
    expect(getImageUserMaxPending(environment)).toBe(20);
    expect(getImageUpstreamMaxAttempts(environment)).toBe(4);
    expect(getImageWorkerMaxAttempts(environment)).toBe(5);
    expect(getImageInputRetentionMs(environment)).toBe(48 * 60 * 60 * 1000);
  });

  it.each(["invalid", "0", "1.5", "9999999999"])(
    "falls back for invalid or unsafe values (%s)",
    (value) => {
      const environment = {
        IMAGE_WORKER_CONCURRENCY: value,
        IMAGE_USER_MAX_PENDING: value,
        IMAGE_UPSTREAM_MAX_ATTEMPTS: value,
        IMAGE_WORKER_MAX_ATTEMPTS: value,
        IMAGE_INPUT_RETENTION_HOURS: value,
      };

      expect(getImageWorkerConcurrency(environment)).toBe(2);
      expect(getImageUserMaxPending(environment)).toBe(3);
      expect(getImageUpstreamMaxAttempts(environment)).toBe(2);
      expect(getImageWorkerMaxAttempts(environment)).toBe(3);
      expect(getImageInputRetentionMs(environment)).toBe(24 * 60 * 60 * 1000);
    },
  );
});
