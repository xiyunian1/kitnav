import { describe, expect, it } from "vitest";
import {
  GENERATED_ARTIFACT_RETENTION_DAYS,
  getGeneratedArtifactExpiresAt,
  isGeneratedArtifactExpired,
} from "./generated-artifact-retention";

describe("generated artifact retention", () => {
  it("uses a fixed seven-day retention period", () => {
    expect(GENERATED_ARTIFACT_RETENTION_DAYS).toBe(7);
    expect(
      getGeneratedArtifactExpiresAt("2026-07-01T12:00:00.000Z")?.toISOString(),
    ).toBe("2026-07-08T12:00:00.000Z");
  });

  it("expires at the exact deadline", () => {
    const completedAt = "2026-07-01T12:00:00.000Z";
    expect(
      isGeneratedArtifactExpired(
        completedAt,
        new Date("2026-07-08T11:59:59.999Z").getTime(),
      ),
    ).toBe(false);
    expect(
      isGeneratedArtifactExpired(
        completedAt,
        new Date("2026-07-08T12:00:00.000Z").getTime(),
      ),
    ).toBe(true);
  });

  it("does not expire records without a valid completion time", () => {
    expect(isGeneratedArtifactExpired(null)).toBe(false);
    expect(isGeneratedArtifactExpired("invalid")).toBe(false);
  });
});
