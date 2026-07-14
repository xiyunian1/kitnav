import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteImageEditInput,
  getImageInputRoot,
  readImageEditInput,
  saveImageEditInput,
  sweepOrphanImageInputs,
} from "./image-inputs";

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "image-inputs-"));
  process.env.IMAGE_INPUT_ROOT = root;
});

afterEach(async () => {
  delete process.env.IMAGE_INPUT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("image edit input storage", () => {
  it("stores and reads a validated private image", async () => {
    const stored = await saveImageEditInput(
      "user_1",
      new Blob([PNG], { type: "image/png" }),
      "参考 图.png",
    );

    expect(stored.token).toMatch(/^[0-9a-f-]+\.png$/);
    expect(stored.filename).toBe("参考_图.png");
    expect(getImageInputRoot()).toBe(root);
    const blob = await readImageEditInput("user_1", stored.token);
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);

    await deleteImageEditInput("user_1", stored.token);
    await expect(readImageEditInput("user_1", stored.token)).rejects.toThrow();
  });

  it("rejects invalid content and path traversal tokens", async () => {
    await expect(
      saveImageEditInput(
        "user_1",
        new Blob([new Uint8Array([1, 2, 3])]),
        "fake.png",
      ),
    ).rejects.toThrow("无效");
    await expect(readImageEditInput("user_1", "../secret.png")).rejects.toThrow(
      "标识",
    );
  });

  it("removes only expired orphan inputs", async () => {
    const userDir = join(root, "user_1");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "active.png"), PNG);
    await writeFile(join(userDir, "orphan.png"), PNG);
    const old = new Date(Date.now() - 60_000);
    await utimes(join(userDir, "active.png"), old, old);
    await utimes(join(userDir, "orphan.png"), old, old);

    const result = await sweepOrphanImageInputs(
      new Set(["active.png"]),
      10_000,
    );
    expect(result).toEqual({ removed: 1, removedBytes: PNG.length });
    await expect(readImageEditInput("user_1", "active.png")).resolves.toBeInstanceOf(
      Blob,
    );
    await expect(readImageEditInput("user_1", "orphan.png")).rejects.toThrow();
  });
});
