import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import sharp from "sharp";
import { validateImageFile } from "@/lib/image-file-validation";
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_COUNT,
  MAX_REFERENCE_TOTAL_BYTES,
  REFERENCE_IMAGE_MIME_TYPES,
} from "@/lib/image-edit-capabilities";

function imageInputRoot() {
  return resolve(
    /* turbopackIgnore: true */ process.env.IMAGE_INPUT_ROOT ||
      join(process.cwd(), "data", "image-inputs"),
  );
}

const ALLOWED_IMAGE_INPUT_TYPES = new Set<string>(REFERENCE_IMAGE_MIME_TYPES);

function assertUserId(userId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error("无效的用户标识");
  }
}

function assertToken(token: string) {
  const safe = basename(token);
  if (!safe || safe !== token || safe.includes("..") || /[\\/]/.test(safe)) {
    throw new Error("无效的图片任务文件标识");
  }
  return safe;
}

function inputPath(userId: string, token: string) {
  assertUserId(userId);
  const inputRoot = imageInputRoot();
  const path = resolve(
    /* turbopackIgnore: true */ inputRoot,
    userId,
    assertToken(token),
  );
  const root = inputRoot.endsWith(sep) ? inputRoot : `${inputRoot}${sep}`;
  if (!path.startsWith(root)) throw new Error("图片任务文件路径非法");
  return path;
}

export interface StoredImageInput {
  token: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  thumbnail: string;
}

export interface StoredImageInputReference {
  token: string;
  filename: string;
}

export interface ImageEditInputFile {
  blob: Blob;
  filename: string;
}

export class ImageInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageInputValidationError";
  }
}

async function createImageInputThumbnail(buffer: Buffer) {
  const thumbnail = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: 80_000_000,
    sequentialRead: true,
    page: 0,
    pages: 1,
  })
    .rotate()
    .resize({
      width: 256,
      height: 256,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 72 })
    .toBuffer();
  return `data:image/webp;base64,${thumbnail.toString("base64")}`;
}

export async function saveImageEditInput(
  userId: string,
  blob: Blob,
  filename: string,
): Promise<StoredImageInput> {
  assertUserId(userId);
  if (blob.size <= 0) throw new ImageInputValidationError("参考图内容为空");
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ImageInputValidationError("参考图不能超过 8MB");
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  let detected;
  try {
    detected = await validateImageFile(buffer, {
      allowedMimeTypes: ALLOWED_IMAGE_INPUT_TYPES,
      invalidMessage: "参考图内容无效或已损坏",
      unsupportedMessage: "参考图仅支持 PNG、JPG、WEBP 或 GIF 格式",
      limitMessage: "参考图像素尺寸或动画帧数过大",
    });
  } catch (error) {
    throw new ImageInputValidationError(
      error instanceof Error ? error.message : "参考图内容无效或已损坏",
    );
  }
  const thumbnail = await createImageInputThumbnail(buffer);

  const userDir = join(
    /* turbopackIgnore: true */ imageInputRoot(),
    userId,
  );
  await mkdir(userDir, { recursive: true, mode: 0o700 });
  const token = `${randomUUID()}.${detected.extension}`;
  await writeFile(
    join(/* turbopackIgnore: true */ userDir, token),
    buffer,
    { mode: 0o600, flag: "wx" },
  );

  const safeFilename = basename(filename || `reference.${detected.extension}`)
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .slice(0, 120);
  return {
    token,
    filename: safeFilename || `reference.${detected.extension}`,
    mimeType: detected.mimeType,
    sizeBytes: buffer.length,
    thumbnail,
  };
}

export async function saveImageEditInputs(
  userId: string,
  inputs: readonly ImageEditInputFile[],
) {
  if (inputs.length < 1) throw new ImageInputValidationError("请上传参考图");
  if (inputs.length > MAX_REFERENCE_IMAGE_COUNT) {
    throw new ImageInputValidationError(
      `参考图最多上传 ${MAX_REFERENCE_IMAGE_COUNT} 张`,
    );
  }
  const totalBytes = inputs.reduce((sum, input) => sum + input.blob.size, 0);
  if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
    throw new ImageInputValidationError("参考图总大小不能超过 30MB");
  }

  const stored: StoredImageInput[] = [];
  try {
    for (const input of inputs) {
      stored.push(
        await saveImageEditInput(userId, input.blob, input.filename),
      );
    }
    return stored;
  } catch (error) {
    const cleanup = await Promise.allSettled(
      stored.map((input) => deleteImageEditInput(userId, input.token)),
    );
    const cleanupErrors = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "参考图保存失败，且部分临时文件回滚失败",
      );
    }
    throw error;
  }
}

export function storedImageInputReferences(
  inputs: readonly StoredImageInput[],
): StoredImageInputReference[] {
  return inputs.map(({ token, filename }) => ({ token, filename }));
}

export function parseStoredImageInputReferences(
  editInputs: string | null,
  legacyToken: string | null,
  legacyFilename: string | null,
): StoredImageInputReference[] {
  if (editInputs !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editInputs);
    } catch {
      throw new Error("图生图参考文件信息无效");
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_REFERENCE_IMAGE_COUNT) {
      throw new Error("图生图参考文件信息无效");
    }
    return parsed.map((item, index) => {
      if (!item || typeof item !== "object") {
        throw new Error("图生图参考文件信息无效");
      }
      const record = item as Record<string, unknown>;
      if (typeof record.token !== "string") {
        throw new Error("图生图参考文件信息无效");
      }
      const token = assertToken(record.token);
      const filename =
        typeof record.filename === "string" && record.filename.trim()
          ? basename(record.filename).slice(0, 120)
          : `reference-${index + 1}.png`;
      return { token, filename };
    });
  }
  return legacyToken
    ? [
        {
          token: assertToken(legacyToken),
          filename: legacyFilename?.trim()
            ? basename(legacyFilename).slice(0, 120)
            : "reference.png",
        },
      ]
    : [];
}

export async function readImageEditInput(userId: string, token: string) {
  const path = inputPath(userId, token);
  const info = await lstat(/* turbopackIgnore: true */ path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("图生图参考文件无效或已过期");
  }
  if (info.size <= 0 || info.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("图生图参考文件大小无效");
  }
  const buffer = await readFile(/* turbopackIgnore: true */ path);
  const detected = await validateImageFile(buffer, {
    allowedMimeTypes: ALLOWED_IMAGE_INPUT_TYPES,
    invalidMessage: "图生图参考文件格式无效",
    unsupportedMessage: "图生图参考文件格式无效",
    limitMessage: "图生图参考文件像素尺寸过大",
  });
  return new Blob([buffer], { type: detected.mimeType });
}

export async function readImageEditInputs(
  userId: string,
  references: readonly StoredImageInputReference[],
): Promise<ImageEditInputFile[]> {
  return Promise.all(
    references.map(async (reference) => ({
      blob: await readImageEditInput(userId, reference.token),
      filename: reference.filename,
    })),
  );
}

export async function deleteImageEditInput(userId: string, token: string | null) {
  if (!token) return;
  await rm(/* turbopackIgnore: true */ inputPath(userId, token), {
    force: true,
  });
}

export async function deleteImageEditInputs(
  userId: string,
  references: readonly Pick<StoredImageInputReference, "token">[],
) {
  const results = await Promise.allSettled(
    references.map((reference) => deleteImageEditInput(userId, reference.token)),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "部分图生图参考文件清理失败");
  }
}

export async function sweepOrphanImageInputs(
  activeTokens: ReadonlySet<string>,
  retentionMs: number,
  now = Date.now(),
) {
  let removed = 0;
  let removedBytes = 0;
  const inputRoot = imageInputRoot();
  const users = await readdir(inputRoot, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const user of users) {
    if (!user.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(user.name)) continue;
    const userDir = join(
      /* turbopackIgnore: true */ inputRoot,
      user.name,
    );
    const files = await readdir(/* turbopackIgnore: true */ userDir, {
      withFileTypes: true,
    });
    for (const file of files) {
      if (!file.isFile() || activeTokens.has(file.name)) continue;
      const path = join(
        /* turbopackIgnore: true */ userDir,
        file.name,
      );
      const info = await stat(/* turbopackIgnore: true */ path);
      if (info.mtimeMs > now - retentionMs) continue;
      await rm(/* turbopackIgnore: true */ path, { force: true });
      removed += 1;
      removedBytes += info.size;
    }
  }
  return { removed, removedBytes };
}

export function getImageInputRoot() {
  return imageInputRoot();
}
