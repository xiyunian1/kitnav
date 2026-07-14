import {
  access,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
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

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ppt-upload-paths-"));
  process.env.PPT_UPLOAD_ROOT = root;
  process.env.PPT_UPLOAD_USER_QUOTA_BYTES = "100";
  process.env.PPT_UPLOAD_USER_MAX_FILES = "1";
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.PPT_UPLOAD_ROOT;
  delete process.env.PPT_UPLOAD_USER_QUOTA_BYTES;
  delete process.env.PPT_UPLOAD_USER_MAX_FILES;
  await rm(root, { recursive: true, force: true });
});

describe("PPT upload paths", () => {
  it("stores private files and enforces the configured file quota", async () => {
    const { resolveUploadPath, savePptUpload } = await import("./upload-paths");
    const stored = await savePptUpload(
      "user_1",
      "source-one.pdf",
      Buffer.from("source"),
    );

    expect(stored).toBe(join(root, "user_1", "source-one.pdf"));
    expect(resolveUploadPath("user_1", "source-one.pdf")).toBe(
      await realpath(stored),
    );
    expect((await stat(join(root, "user_1"))).mode & 0o777).toBe(0o700);
    expect((await stat(stored)).mode & 0o777).toBe(0o600);
    await expect(
      savePptUpload("user_1", "source-two.pdf", Buffer.from("source")),
    ).rejects.toThrow("数量已达上限");
  });

  it("enforces the byte quota for the first and subsequent files", async () => {
    process.env.PPT_UPLOAD_USER_MAX_FILES = "5";
    const { savePptUpload } = await import("./upload-paths");

    await expect(
      savePptUpload("user_1", "too-large.pdf", Buffer.alloc(101)),
    ).rejects.toThrow("上传空间不足");
    await expect(access(join(root, "user_1", "too-large.pdf"))).rejects.toThrow();

    await savePptUpload("user_1", "first.pdf", Buffer.alloc(60));
    await expect(
      savePptUpload("user_1", "second.pdf", Buffer.alloc(41)),
    ).rejects.toThrow("上传空间不足");
    await expect(access(join(root, "user_1", "second.pdf"))).rejects.toThrow();
  });

  it("rejects traversal names and symlinked owner directories", async () => {
    const outside = await mkdtemp(join(tmpdir(), "ppt-upload-outside-"));
    const { savePptUpload } = await import("./upload-paths");
    await expect(
      savePptUpload("user_1", "../outside.pdf", Buffer.from("source")),
    ).rejects.toThrow("无效的上传文件标识");

    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, "user_1"));
    try {
      await expect(
        savePptUpload("user_1", "source.pdf", Buffer.from("source")),
      ).rejects.toThrow("上传目录无效");
      await expect(access(join(outside, "source.pdf"))).rejects.toThrow();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
