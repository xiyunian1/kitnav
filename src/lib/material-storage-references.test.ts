import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteStoredUploadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { material: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/upload-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/upload-storage")>();
  return {
    ...actual,
    deleteStoredUploadFile: mocks.deleteStoredUploadFile,
  };
});

import {
  deleteUnreferencedMaterialFile,
  isMaterialStorageKeyReferencedByUser,
} from "./material-storage-references";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("material storage references", () => {
  it("recognizes a storage key referenced by a user's material", async () => {
    mocks.findFirst.mockResolvedValue({ id: "copy_1" });

    await expect(
      isMaterialStorageKeyReferencedByUser("owner/cover.png", "collector"),
    ).resolves.toBe(true);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: "collector" }),
      }),
    );
  });

  it("deletes only files with no remaining material reference", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: "copy_1" });
    await expect(
      deleteUnreferencedMaterialFile("owner/cover.png"),
    ).resolves.toBe(false);
    expect(mocks.deleteStoredUploadFile).not.toHaveBeenCalled();

    mocks.findFirst.mockResolvedValueOnce(null);
    await expect(
      deleteUnreferencedMaterialFile("owner/orphan.png"),
    ).resolves.toBe(true);
    expect(mocks.deleteStoredUploadFile).toHaveBeenCalledWith(
      "materials",
      "owner/orphan.png",
    );
  });

  it("ignores invalid storage keys", async () => {
    await expect(
      deleteUnreferencedMaterialFile("../outside.png"),
    ).resolves.toBe(false);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.deleteStoredUploadFile).not.toHaveBeenCalled();
  });
});
