import { access, mkdtemp, readdir, rm } from "node:fs/promises";
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
  deleteFeedbackScreenshots,
  feedbackStorageKeyBelongsToUser,
  feedbackStorageKeyFromUrl,
  parseScreenshotUrls,
  saveFeedbackScreenshots,
} from "./feedback";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "feedback-storage-"));
  process.env.FEEDBACK_UPLOAD_ROOT = root;
  process.env.FEEDBACK_USER_QUOTA_BYTES = "100";
  process.env.FEEDBACK_USER_MAX_FILES = "2";
});

afterEach(async () => {
  delete process.env.FEEDBACK_UPLOAD_ROOT;
  delete process.env.FEEDBACK_USER_QUOTA_BYTES;
  delete process.env.FEEDBACK_USER_MAX_FILES;
  await rm(root, { recursive: true, force: true });
});

describe("feedback screenshot storage", () => {
  it("stores screenshots privately and removes them by URL", async () => {
    const [url] = await saveFeedbackScreenshots(
      [new File([PNG], "screen.png", { type: "image/png" })],
      "user_1",
    );
    expect(url).toMatch(/^\/api\/files\/feedback\/user_1\/[0-9a-f-]+\.png$/);
    const storageKey = feedbackStorageKeyFromUrl(url)!;
    expect(feedbackStorageKeyBelongsToUser(storageKey, "user_1")).toBe(true);
    await expect(access(join(root, storageKey))).resolves.toBeUndefined();

    await deleteFeedbackScreenshots([url]);
    await expect(access(join(root, storageKey))).rejects.toThrow();
  });

  it("rejects spoofed MIME types and rolls back earlier files", async () => {
    await expect(
      saveFeedbackScreenshots(
        [
          new File([PNG], "valid.png", { type: "image/png" }),
          new File(["not an image"], "fake.png", { type: "image/png" }),
        ],
        "user_1",
      ),
    ).rejects.toThrow("无效");
    await expect(readdir(join(root, "user_1"))).resolves.toEqual([]);
  });

  it("enforces per-user file quotas", async () => {
    process.env.FEEDBACK_USER_MAX_FILES = "1";
    await saveFeedbackScreenshots(
      [new File([PNG], "first.png", { type: "image/png" })],
      "user_1",
    );
    await expect(
      saveFeedbackScreenshots(
        [new File([PNG], "second.png", { type: "image/png" })],
        "user_1",
      ),
    ).rejects.toThrow("存储空间已达上限");
  });

  it("normalizes legacy screenshot URLs", () => {
    expect(
      parseScreenshotUrls(
        JSON.stringify(["/uploads/feedback/user_1-legacy.png"]),
      ),
    ).toEqual(["/api/files/feedback/user_1-legacy.png"]);
  });
});
