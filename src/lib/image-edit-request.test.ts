import { describe, expect, it } from "vitest";
import { parseReferenceImageUploads } from "./image-edit-request";

function imageFile(name: string, size = 1, type = "image/png") {
  return new File([new Uint8Array(size)], name, { type });
}

describe("parseReferenceImageUploads", () => {
  it("reads repeated images fields in order", () => {
    const form = new FormData();
    form.append("images", imageFile("01.png"));
    form.append("images", imageFile("02.webp", 2, "image/webp"));
    form.append("images", imageFile("03.jpg", 3, "image/jpeg"));

    const images = parseReferenceImageUploads(form);
    expect(images.map((image) => image.filename)).toEqual([
      "01.png",
      "02.webp",
      "03.jpg",
    ]);
    expect(images.map((image) => image.blob.size)).toEqual([1, 2, 3]);
  });

  it("falls back to the legacy single image field", () => {
    const form = new FormData();
    form.append("image", imageFile("legacy.png"));

    expect(parseReferenceImageUploads(form)).toHaveLength(1);
    expect(parseReferenceImageUploads(form)[0]?.filename).toBe("legacy.png");
  });

  it("rejects a seventeenth image", () => {
    const form = new FormData();
    for (let index = 0; index < 17; index += 1) {
      form.append("images", imageFile(`${index}.png`));
    }
    expect(() => parseReferenceImageUploads(form)).toThrow("最多上传 16 张");
  });

  it("accepts exactly sixteen images without changing their order", () => {
    const form = new FormData();
    for (let index = 0; index < 16; index += 1) {
      form.append("images", imageFile(`${String(index + 1).padStart(2, "0")}.png`));
    }
    expect(
      parseReferenceImageUploads(form).map((image) => image.filename),
    ).toEqual(
      Array.from(
        { length: 16 },
        (_, index) => `${String(index + 1).padStart(2, "0")}.png`,
      ),
    );
  });

  it("rejects empty, unsupported, oversized, and over-budget batches", () => {
    const empty = new FormData();
    empty.append("images", imageFile("empty.png", 0));
    expect(() => parseReferenceImageUploads(empty)).toThrow("内容为空");

    const unsupported = new FormData();
    unsupported.append("images", imageFile("bad.svg", 1, "image/svg+xml"));
    expect(() => parseReferenceImageUploads(unsupported)).toThrow("仅支持");

    const oversized = new FormData();
    oversized.append("images", imageFile("large.png", 8 * 1024 * 1024 + 1));
    expect(() => parseReferenceImageUploads(oversized)).toThrow("不能超过 8MB");

    const batch = new FormData();
    for (let index = 0; index < 4; index += 1) {
      batch.append("images", imageFile(`${index}.png`, 8 * 1024 * 1024));
    }
    expect(() => parseReferenceImageUploads(batch)).toThrow("总大小不能超过 30MB");
  });
});
