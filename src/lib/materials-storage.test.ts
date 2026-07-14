import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/upload-storage-lock", () => ({
  withUploadStorageLock: async (
    _kind: string,
    _ownerId: string,
    callback: () => Promise<unknown>,
  ) => callback(),
}));
import {
  deleteStoredMaterialFile,
  deleteStoredMaterialUrl,
  getMaterialStorageUsage,
  materialStorageKeyBelongsToUser,
  normalizeStoredMaterialUrl,
  saveImageBlob,
  saveImageFromUrl,
} from "./materials";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "materials-storage-"));
  process.env.MATERIAL_UPLOAD_ROOT = root;
  process.env.MATERIAL_USER_QUOTA_BYTES = "1000";
  process.env.MATERIAL_USER_MAX_FILES = "2";
});

afterEach(async () => {
  delete process.env.MATERIAL_UPLOAD_ROOT;
  delete process.env.MATERIAL_USER_QUOTA_BYTES;
  delete process.env.MATERIAL_USER_MAX_FILES;
  await rm(root, { recursive: true, force: true });
});

describe("material storage", () => {
  it("stores new files in an owner directory and deletes them by URL", async () => {
    const stored = await saveImageBlob(
      new Blob([PNG], { type: "image/png" }),
      "user_1",
    );
    expect(stored.storageKey).toMatch(/^user_1\/asset-[0-9a-f-]+\.png$/);
    expect(stored.url).toBe(`/api/files/materials/${stored.storageKey}`);
    await expect(access(join(root, stored.storageKey))).resolves.toBeUndefined();

    const copied = await saveImageFromUrl(stored.url, "user_1", {
      namePrefix: "copy",
    });
    expect(copied.storageKey).not.toBe(stored.storageKey);
    expect(materialStorageKeyBelongsToUser(copied.storageKey, "user_1")).toBe(
      true,
    );

    await deleteStoredMaterialUrl(stored.url);
    await deleteStoredMaterialUrl(copied.url);
    await expect(access(join(root, stored.storageKey))).rejects.toThrow();
  });

  it("prevents cross-user local copies unless a reviewed key is allowed", async () => {
    const stored = await saveImageBlob(
      new Blob([PNG], { type: "image/png" }),
      "user_1",
    );

    await expect(saveImageFromUrl(stored.url, "user_2")).rejects.toThrow(
      "无权读取",
    );
    const publicCopy = await saveImageFromUrl(stored.url, "user_2", {
      allowedLocalStorageKey: stored.storageKey,
    });
    expect(materialStorageKeyBelongsToUser(publicCopy.storageKey, "user_2")).toBe(
      true,
    );
  });

  it("normalizes legacy public URLs to the authenticated file endpoint", () => {
    expect(normalizeStoredMaterialUrl("/uploads/materials/user_1/old.png")).toBe(
      "/api/files/materials/user_1/old.png",
    );
  });

  it("enforces byte and file quotas including legacy flat files", async () => {
    process.env.MATERIAL_USER_MAX_FILES = "3";
    process.env.MATERIAL_USER_QUOTA_BYTES = "900";
    await writeFile(join(root, "user_1-legacy.png"), new Uint8Array(800));
    await expect(
      saveImageBlob(new Blob([PNG]), "user_1"),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(saveImageBlob(new Blob([PNG]), "user_1")).rejects.toThrow(
      "存储空间不足",
    );
  });

  it("reports generated and legacy files against the configured quota", async () => {
    const stored = await saveImageBlob(
      new Blob([PNG], { type: "image/png" }),
      "user_1",
    );
    await writeFile(join(root, "user_1-legacy.png"), new Uint8Array(5));

    await expect(getMaterialStorageUsage("user_1")).resolves.toEqual({
      usedBytes: PNG.length + 5,
      fileCount: 2,
      maxBytes: 1000,
      maxFiles: 2,
    });
    await deleteStoredMaterialFile(stored.storageKey);
  });

  it("ignores traversal storage keys", async () => {
    const outside = join(root, "..", "outside-material.txt");
    await writeFile(outside, "keep");
    try {
      await deleteStoredMaterialFile("../outside-material.txt");
      await expect(access(outside)).resolves.toBeUndefined();
    } finally {
      await rm(outside, { force: true });
    }
  });
});
