import { describe, expect, it } from "vitest";
import {
  areImageArtifactsExpired,
  getImageArtifactExpiresAt,
  imageTurnStorageKeys,
} from "./image-result-retention";

describe("image result retention", () => {
  it("keeps pending turns and expires terminal turns after seven days", () => {
    const completedAt = new Date("2026-07-01T00:00:00.000Z");

    expect(
      areImageArtifactsExpired(
        {
          status: "PENDING",
          completedAt,
          updatedAt: completedAt,
        },
        new Date("2026-08-01T00:00:00.000Z").getTime(),
      ),
    ).toBe(false);
    expect(
      getImageArtifactExpiresAt({
        status: "SUCCESS",
        completedAt,
      })?.toISOString(),
    ).toBe("2026-07-08T00:00:00.000Z");
    expect(
      areImageArtifactsExpired(
        { status: "SUCCESS", completedAt },
        new Date("2026-07-08T00:00:00.000Z").getTime(),
      ),
    ).toBe(true);
  });

  it("uses updatedAt for terminal rows created before completedAt existed", () => {
    expect(
      getImageArtifactExpiresAt({
        status: "FAILED",
        completedAt: null,
        updatedAt: "2026-07-02T00:00:00.000Z",
      })?.toISOString(),
    ).toBe("2026-07-09T00:00:00.000Z");
  });

  it("extracts unique local storage keys and ignores external URLs", () => {
    const images = JSON.stringify([
      {
        id: "0",
        status: "success",
        url: "/api/files/materials/user-1/generated-a.png",
      },
      {
        id: "1",
        status: "success",
        url: "/uploads/materials/user-1/generated-a.png",
      },
      {
        id: "2",
        status: "success",
        url: "https://example.com/external.png",
      },
    ]);

    expect(imageTurnStorageKeys(images)).toEqual([
      "user-1/generated-a.png",
    ]);
    expect(imageTurnStorageKeys("not-json")).toEqual([]);
  });
});
