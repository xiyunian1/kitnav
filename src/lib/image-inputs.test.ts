import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteImageEditInput,
  deleteImageEditInputs,
  getImageInputRoot,
  readImageEditInput,
  readImageEditInputs,
  parseStoredImageInputReferences,
  saveImageEditInput,
  saveImageEditInputs,
  storedImageInputReferences,
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
    expect(stored.thumbnail).toMatch(/^data:image\/webp;base64,/);
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

  it("stores, reads, and deletes an ordered reference-image batch", async () => {
    const stored = await saveImageEditInputs("user_1", [
      { blob: new Blob([PNG], { type: "image/png" }), filename: "01.png" },
      { blob: new Blob([PNG], { type: "image/png" }), filename: "02.png" },
      { blob: new Blob([PNG], { type: "image/png" }), filename: "03.png" },
    ]);
    const references = storedImageInputReferences(stored);

    expect(references.map((reference) => reference.filename)).toEqual([
      "01.png",
      "02.png",
      "03.png",
    ]);
    expect(stored.every((input) => input.thumbnail.startsWith("data:image/webp"))).toBe(
      true,
    );
    const files = await readImageEditInputs("user_1", references);
    expect(files.map((file) => file.filename)).toEqual(["01.png", "02.png", "03.png"]);
    expect(await Promise.all(files.map((file) => file.blob.arrayBuffer()))).toHaveLength(3);

    await deleteImageEditInputs("user_1", references);
    await expect(readImageEditInput("user_1", references[0]!.token)).rejects.toThrow();
  });

  it("rolls back files already saved when a later reference is invalid", async () => {
    await expect(
      saveImageEditInputs("user_1", [
        { blob: new Blob([PNG], { type: "image/png" }), filename: "valid.png" },
        { blob: new Blob([new Uint8Array([1, 2, 3])]), filename: "invalid.png" },
      ]),
    ).rejects.toThrow("无效");

    expect(await readdir(join(root, "user_1"))).toEqual([]);
  });

  it("prefers new metadata and falls back to legacy single-image metadata", () => {
    expect(
      parseStoredImageInputReferences(
        JSON.stringify([
          { token: "first.png", filename: "first.png" },
          { token: "second.png", filename: "second.png" },
        ]),
        "legacy.png",
        "legacy.png",
      ),
    ).toEqual([
      { token: "first.png", filename: "first.png" },
      { token: "second.png", filename: "second.png" },
    ]);
    expect(
      parseStoredImageInputReferences(null, "legacy.png", "legacy name.png"),
    ).toEqual([{ token: "legacy.png", filename: "legacy name.png" }]);
    expect(() =>
      parseStoredImageInputReferences("not-json", "legacy.png", "legacy.png"),
    ).toThrow("信息无效");
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
