import sharp from "sharp";

export const DEFAULT_MAX_IMAGE_DIMENSION = 16_384;
export const DEFAULT_MAX_IMAGE_FRAME_PIXELS = 40_000_000;
export const DEFAULT_MAX_IMAGE_TOTAL_PIXELS = 80_000_000;
export const DEFAULT_MAX_IMAGE_FRAMES = 100;

const DEFAULT_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const IMAGE_FORMATS: Record<
  string,
  { mimeType: string; extension: "png" | "jpg" | "webp" | "gif" }
> = {
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
  gif: { mimeType: "image/gif", extension: "gif" },
};

export interface ImageFileValidationOptions {
  allowedMimeTypes?: ReadonlySet<string>;
  maxDimension?: number;
  maxFramePixels?: number;
  maxTotalPixels?: number;
  maxFrames?: number;
  invalidMessage?: string;
  unsupportedMessage?: string;
  limitMessage?: string;
}

export interface ValidatedImageFile {
  mimeType: string;
  extension: "png" | "jpg" | "webp" | "gif";
  width: number;
  height: number;
  frames: number;
}

export async function validateImageFile(
  buffer: Buffer,
  options: ImageFileValidationOptions = {},
): Promise<ValidatedImageFile> {
  const invalidMessage = options.invalidMessage ?? "图片内容格式不正确";
  const unsupportedMessage =
    options.unsupportedMessage ?? "仅支持 PNG、JPG、WEBP、GIF 图片";
  const limitMessage = options.limitMessage ?? "图片像素尺寸或动画帧数过大";
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
  const maxFramePixels =
    options.maxFramePixels ?? DEFAULT_MAX_IMAGE_FRAME_PIXELS;
  const maxTotalPixels =
    options.maxTotalPixels ?? DEFAULT_MAX_IMAGE_TOTAL_PIXELS;
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_IMAGE_FRAMES;
  const allowedMimeTypes =
    options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;

  if (buffer.byteLength === 0) throw new Error(invalidMessage);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: maxTotalPixels,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new Error(invalidMessage);
  }

  const format = metadata.format ? IMAGE_FORMATS[metadata.format] : undefined;
  if (!format || !allowedMimeTypes.has(format.mimeType)) {
    throw new Error(unsupportedMessage);
  }

  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  const frames = metadata.pages ?? 1;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(frames) ||
    !width ||
    !height ||
    frames < 1
  ) {
    throw new Error(invalidMessage);
  }

  const framePixels = width * height;
  const totalPixels = framePixels * frames;
  if (
    width > maxDimension ||
    height > maxDimension ||
    frames > maxFrames ||
    !Number.isSafeInteger(framePixels) ||
    !Number.isSafeInteger(totalPixels) ||
    framePixels > maxFramePixels ||
    totalPixels > maxTotalPixels
  ) {
    throw new Error(limitMessage);
  }

  try {
    await sharp(buffer, {
      failOn: "error",
      limitInputPixels: maxTotalPixels,
      sequentialRead: true,
    })
      .resize({
        width: 1,
        height: 1,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer();
  } catch {
    throw new Error(invalidMessage);
  }

  return {
    mimeType: format.mimeType,
    extension: format.extension,
    width,
    height,
    frames,
  };
}
