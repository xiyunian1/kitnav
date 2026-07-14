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
import { validateImageFile } from "@/lib/image-file-validation";

const MAX_EDIT_INPUT_BYTES = 8 * 1024 * 1024;

function imageInputRoot() {
  return resolve(
    /* turbopackIgnore: true */ process.env.IMAGE_INPUT_ROOT ||
      join(process.cwd(), "data", "image-inputs"),
  );
}

const ALLOWED_IMAGE_INPUT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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
}

export async function saveImageEditInput(
  userId: string,
  blob: Blob,
  filename: string,
): Promise<StoredImageInput> {
  assertUserId(userId);
  if (blob.size <= 0) throw new Error("参考图内容为空");
  if (blob.size > MAX_EDIT_INPUT_BYTES) throw new Error("参考图不能超过 8MB");

  const buffer = Buffer.from(await blob.arrayBuffer());
  const detected = await validateImageFile(buffer, {
    allowedMimeTypes: ALLOWED_IMAGE_INPUT_TYPES,
    invalidMessage: "参考图内容无效或已损坏",
    unsupportedMessage: "参考图仅支持 PNG、JPG、WEBP 或 GIF 格式",
    limitMessage: "参考图像素尺寸或动画帧数过大",
  });

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
  };
}

export async function readImageEditInput(userId: string, token: string) {
  const path = inputPath(userId, token);
  const info = await lstat(/* turbopackIgnore: true */ path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("图生图参考文件无效或已过期");
  }
  if (info.size <= 0 || info.size > MAX_EDIT_INPUT_BYTES) {
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

export async function deleteImageEditInput(userId: string, token: string | null) {
  if (!token) return;
  await rm(/* turbopackIgnore: true */ inputPath(userId, token), {
    force: true,
  });
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
