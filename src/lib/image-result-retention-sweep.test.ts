import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  generationUpdateMany: vi.fn(),
  transaction: vi.fn(),
  deleteUnreferenced: vi.fn(),
  deleteInputs: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    imageTurn: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/material-storage-references", () => ({
  deleteUnreferencedMaterialFile: mocks.deleteUnreferenced,
}));
vi.mock("@/lib/image-inputs", () => ({
  parseStoredImageInputReferences: () => [],
  deleteImageEditInputs: mocks.deleteInputs,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn() },
}));

import { sweepExpiredImageArtifacts } from "./image-result-retention";

describe("expired image artifact sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.generationUpdateMany.mockResolvedValue({ count: 1 });
    mocks.deleteInputs.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        imageTurn: { updateMany: mocks.updateMany },
        generation: { updateMany: mocks.generationUpdateMany },
      }),
    );
  });

  it("removes unsaved files while preserving files referenced by materials", async () => {
    mocks.findMany
      .mockResolvedValueOnce([
        expiredTurn(
          "turn-saved",
          "/api/files/materials/user-1/saved-by-material.png",
        ),
        expiredTurn(
          "turn-unsaved",
          "/api/files/materials/user-1/generated-only.png",
        ),
      ])
      .mockResolvedValue([]);
    mocks.deleteUnreferenced.mockImplementation(async (storageKey: string) =>
      storageKey.endsWith("generated-only.png"),
    );

    await expect(
      sweepExpiredImageArtifacts(
        new Date("2026-07-20T00:00:00.000Z").getTime(),
      ),
    ).resolves.toEqual({
      turnsExpired: 2,
      filesRemoved: 1,
      filesPreserved: 1,
    });

    expect(mocks.deleteUnreferenced).toHaveBeenCalledWith(
      "user-1/saved-by-material.png",
    );
    expect(mocks.deleteUnreferenced).toHaveBeenCalledWith(
      "user-1/generated-only.png",
    );
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
  });

  it("preserves a file still referenced by another unexpired image turn", async () => {
    const url = "/api/files/materials/user-1/shared-result.png";
    mocks.findMany
      .mockResolvedValueOnce([expiredTurn("turn-expired", url)])
      .mockResolvedValueOnce([{ images: JSON.stringify([{ url }]) }]);

    await expect(
      sweepExpiredImageArtifacts(
        new Date("2026-07-20T00:00:00.000Z").getTime(),
      ),
    ).resolves.toEqual({
      turnsExpired: 1,
      filesRemoved: 0,
      filesPreserved: 1,
    });

    expect(mocks.deleteUnreferenced).not.toHaveBeenCalled();
  });
});

function expiredTurn(id: string, url: string) {
  return {
    id,
    status: "SUCCESS",
    images: JSON.stringify([{ id: "0", status: "success", url }]),
    editInputs: null,
    editInputPath: null,
    editInputName: null,
    generationId: `${id}-generation`,
    conversation: { userId: "user-1" },
  };
}
