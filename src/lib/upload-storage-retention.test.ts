import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sweepUploadStorageFiles } from "./upload-storage-retention";

const CONTENT = new Uint8Array([1, 2, 3, 4]);
let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-retention-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("upload storage retention", () => {
  it("removes only old unreferenced supported images without following symlinks", async () => {
    const storageRoot = join(root, "uploads");
    const referencedDir = join(storageRoot, "user_ref");
    const orphanDir = join(storageRoot, "user_orphan");
    const recentDir = join(storageRoot, "user_recent");
    await Promise.all([
      mkdir(referencedDir, { recursive: true }),
      mkdir(orphanDir, { recursive: true }),
      mkdir(recentDir, { recursive: true }),
    ]);

    const referenced = join(referencedDir, "referenced.jpg");
    const nestedOrphan = join(orphanDir, "orphan.webp");
    const flatOrphan = join(storageRoot, "legacy-orphan.png");
    const recent = join(recentDir, "recent.gif");
    const unsupported = join(storageRoot, "keep.txt");
    const symlinkTarget = join(root, "outside.png");
    const linked = join(storageRoot, "linked.png");
    await Promise.all([
      writeFile(referenced, CONTENT),
      writeFile(nestedOrphan, CONTENT),
      writeFile(flatOrphan, CONTENT),
      writeFile(recent, CONTENT),
      writeFile(unsupported, CONTENT),
      writeFile(symlinkTarget, CONTENT),
    ]);
    await symlink(symlinkTarget, linked);

    const now = Date.now();
    const old = new Date(now - 60_000);
    await Promise.all([
      utimes(referenced, old, old),
      utimes(nestedOrphan, old, old),
      utimes(orphanDir, old, old),
      utimes(flatOrphan, old, old),
      utimes(unsupported, old, old),
      utimes(symlinkTarget, old, old),
    ]);

    const result = await sweepUploadStorageFiles({
      roots: [
        {
          root: storageRoot,
          referencedStorageKeys: new Set(["user_ref/referenced.jpg"]),
        },
      ],
      retentionMs: 10_000,
      now,
    });

    expect(result).toEqual({
      rootsScanned: 1,
      filesScanned: 4,
      filesRemoved: 2,
      bytesRemoved: CONTENT.length * 2,
      directoriesRemoved: 1,
    });
    await expect(access(referenced)).resolves.toBeUndefined();
    await expect(access(recent)).resolves.toBeUndefined();
    await expect(access(unsupported)).resolves.toBeUndefined();
    await expect(access(linked)).resolves.toBeUndefined();
    await expect(access(symlinkTarget)).resolves.toBeUndefined();
    await expect(access(nestedOrphan)).rejects.toThrow();
    await expect(access(flatOrphan)).rejects.toThrow();
    await expect(access(orphanDir)).rejects.toThrow();
  });

  it("keeps a recently created empty owner directory", async () => {
    const storageRoot = join(root, "uploads");
    const ownerDirectory = join(storageRoot, "upload_in_progress");
    await mkdir(ownerDirectory, { recursive: true });

    const result = await sweepUploadStorageFiles({
      roots: [{ root: storageRoot, referencedStorageKeys: new Set() }],
      retentionMs: 10_000,
      now: Date.now(),
    });

    expect(result.directoriesRemoved).toBe(0);
    await expect(access(ownerDirectory)).resolves.toBeUndefined();
  });

  it("rejects nested storage roots before deleting files", async () => {
    await expect(
      sweepUploadStorageFiles({
        roots: [
          { root, referencedStorageKeys: new Set() },
          { root: join(root, "nested"), referencedStorageKeys: new Set() },
        ],
        retentionMs: 10_000,
      }),
    ).rejects.toThrow("不能互相嵌套");
  });
});
