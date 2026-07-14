import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateImageFile } from "./image-file-validation";

describe("validateImageFile", () => {
  it("returns trusted metadata after decoding a supported image", async () => {
    const image = await sharp({
      create: {
        width: 2,
        height: 3,
        channels: 4,
        background: { r: 20, g: 40, b: 60, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    await expect(validateImageFile(image)).resolves.toEqual({
      mimeType: "image/png",
      extension: "png",
      width: 2,
      height: 3,
      frames: 1,
    });
  });

  it("rejects truncated files that only contain a valid signature", async () => {
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    await expect(validateImageFile(signature)).rejects.toThrow("格式不正确");
  });

  it("enforces decoded pixel limits before accepting an image", async () => {
    const image = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    await expect(
      validateImageFile(image, { maxFramePixels: 3 }),
    ).rejects.toThrow("像素尺寸");
  });

  it("enforces the caller's image format policy", async () => {
    const image = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    await expect(
      validateImageFile(image, {
        allowedMimeTypes: new Set(["image/png"]),
        unsupportedMessage: "only png",
      }),
    ).rejects.toThrow("only png");
  });
});
