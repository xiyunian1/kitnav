import {
  mkdir,
  readFile,
  readdir,
  lstat,
  writeFile,
} from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { fetchPublicResource } from "@/lib/safe-fetch";
import { validateImageFile } from "@/lib/image-file-validation";
import {
  deleteStoredUploadFile,
  findStoredUploadFile,
  getUploadDirectory,
  parseUploadStorageKey,
  resolveUploadStoragePath,
  uploadDirectories,
} from "@/lib/upload-storage";
import { withUploadStorageLock } from "@/lib/upload-storage-lock";
import type {
  Material,
  MaterialFavorite,
  MaterialLike,
  MaterialOwnerType,
  MaterialStatus,
  MaterialType,
  MaterialVisibility,
  User,
} from "@prisma/client";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type MaterialWithOwner = Material & {
  owner?: Pick<User, "id" | "name" | "email"> | null;
  favorites?: MaterialFavorite[];
  likes?: MaterialLike[];
  _count?: { favorites: number; likes: number };
};

export interface SerializedMaterial {
  id: string;
  ownerId: string | null;
  ownerName: string;
  ownerType: MaterialOwnerType;
  type: MaterialType;
  source: string;
  visibility: MaterialVisibility;
  status: MaterialStatus;
  title: string;
  description: string | null;
  tags: string[];
  url: string;
  thumbnailUrl: string | null;
  promptText: string | null;
  promptMeta: Record<string, unknown> | null;
  rejectionReason: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sourceGenerationId: string | null;
  favoriteCount: number;
  favorited: boolean;
  likeCount: number;
  liked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialStorageUsage {
  usedBytes: number;
  fileCount: number;
  maxBytes: number;
  maxFiles: number;
}

function assertOwnerId(ownerId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(ownerId)) {
    throw new Error("无效的素材所有者标识");
  }
}

export function materialFileUrl(storageKey: string) {
  parseUploadStorageKey(storageKey);
  return `/api/files/materials/${storageKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function materialStorageKeyFromUrl(url: string) {
  let pathname: string;
  try {
    pathname = new URL(url, "http://local.invalid").pathname;
  } catch {
    return null;
  }
  const prefixes = ["/api/files/materials/", "/uploads/materials/"];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;
  try {
    const storageKey = pathname
      .slice(prefix.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
    parseUploadStorageKey(storageKey);
    return storageKey;
  } catch {
    return null;
  }
}

export function normalizeStoredMaterialUrl(url: string | null | undefined) {
  if (!url) return url ?? null;
  const storageKey = materialStorageKeyFromUrl(url);
  return storageKey ? materialFileUrl(storageKey) : url;
}

export function materialStorageKeyBelongsToUser(
  storageKey: string,
  userId: string,
) {
  try {
    const segments = parseUploadStorageKey(storageKey);
    return segments.length === 2
      ? segments[0] === userId
      : segments[0].startsWith(`${userId}-`);
  } catch {
    return false;
  }
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function assertMaterialStorageQuota(
  ownerId: string,
  incomingBytes: number,
) {
  assertOwnerId(ownerId);
  const usage = await getMaterialStorageUsage(ownerId);
  if (incomingBytes > usage.maxBytes) {
    throw new Error(
      `图片存储空间不足，每个用户最多 ${formatQuotaBytes(usage.maxBytes)}`,
    );
  }
  if (usage.fileCount >= usage.maxFiles) {
    throw new Error(`图片存储文件数已达上限（${usage.maxFiles} 个）`);
  }
  if (usage.usedBytes + incomingBytes > usage.maxBytes) {
    throw new Error(
      `图片存储空间不足（已用 ${formatQuotaBytes(usage.usedBytes)} / ${formatQuotaBytes(usage.maxBytes)}）`,
    );
  }
}

export async function getMaterialStorageUsage(
  ownerId: string,
): Promise<MaterialStorageUsage> {
  assertOwnerId(ownerId);
  const paths: string[] = [];
  for (const root of uploadDirectories("materials")) {
    const ownerDir = path.join(/* turbopackIgnore: true */ root, ownerId);
    const ownerFiles = await readdir(ownerDir, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const legacyFiles = await readdir(root, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    paths.push(
      ...ownerFiles
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path.join(/* turbopackIgnore: true */ ownerDir, entry.name),
        ),
      ...legacyFiles
        .filter(
          (entry) => entry.isFile() && entry.name.startsWith(`${ownerId}-`),
        )
        .map((entry) =>
          path.join(/* turbopackIgnore: true */ root, entry.name),
        ),
    );
  }
  let usedBytes = 0;
  let fileCount = 0;
  for (let index = 0; index < paths.length; index += 100) {
    const infos = await Promise.all(
      paths.slice(index, index + 100).map((filePath) =>
        lstat(filePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
      ),
    );
    for (const info of infos) {
      if (!info?.isFile() || info.isSymbolicLink()) continue;
      fileCount += 1;
      usedBytes += info.size;
    }
  }
  return {
    usedBytes,
    fileCount,
    maxBytes: positiveIntegerEnv(
      "MATERIAL_USER_QUOTA_BYTES",
      1024 * 1024 * 1024,
    ),
    maxFiles: positiveIntegerEnv("MATERIAL_USER_MAX_FILES", 2000),
  };
}

function formatQuotaBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

export function parseTags(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((tag) => String(tag).trim())
        .filter(Boolean)
        .slice(0, 12);
    }
  } catch {
    // fall through to delimiter parsing
  }
  return value
    .split(/[,\s，、#]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function tagsToJson(tags: string[] | string | undefined | null): string | null {
  const list = Array.isArray(tags) ? tags : parseTags(tags);
  const unique = Array.from(new Set(list.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
  return unique.length ? JSON.stringify(unique) : null;
}

export function parsePromptMeta(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function serializeMaterial(material: MaterialWithOwner, currentUserId?: string): SerializedMaterial {
  const storedUrl = material.storageKey
    ? materialFileUrl(material.storageKey)
    : normalizeStoredMaterialUrl(material.url) ?? material.url;
  const thumbnailUrl =
    material.storageKey && material.thumbnailUrl
      ? materialFileUrl(material.storageKey)
      : normalizeStoredMaterialUrl(material.thumbnailUrl);
  return {
    id: material.id,
    ownerId: material.ownerId,
    ownerName:
      material.ownerType === "PLATFORM"
        ? "平台官方"
        : material.owner?.name || material.owner?.email || "用户",
    ownerType: material.ownerType,
    type: material.type,
    source: material.source,
    visibility: material.visibility,
    status: material.status,
    title: material.title,
    description: material.description,
    tags: parseTags(material.tags),
    url: storedUrl,
    thumbnailUrl,
    promptText: material.promptText,
    promptMeta: parsePromptMeta(material.promptMeta),
    rejectionReason: material.rejectionReason,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
    width: material.width,
    height: material.height,
    durationSec: material.durationSec,
    sourceGenerationId: material.sourceGenerationId,
    favoriteCount: material._count?.favorites ?? material.favorites?.length ?? 0,
    favorited: currentUserId
      ? Boolean(material.favorites?.some((favorite) => favorite.userId === currentUserId))
      : false,
    likeCount: material._count?.likes ?? material.likes?.length ?? 0,
    liked: currentUserId
      ? Boolean(material.likes?.some((like) => like.userId === currentUserId))
      : false,
    createdAt: material.createdAt.toISOString(),
    updatedAt: material.updatedAt.toISOString(),
  };
}

async function ensureImageBuffer(buffer: Buffer) {
  if (buffer.byteLength <= 0) throw new Error("图片内容为空");
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("图片不能超过 8MB");
  const validated = await validateImageFile(buffer, {
    allowedMimeTypes: ALLOWED_IMAGE_TYPES,
  });
  return { mimeType: validated.mimeType, ext: validated.extension };
}

export async function saveImageBlob(blob: Blob, ownerId: string) {
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return saveImageBuffer(buffer, ownerId);
}

async function saveImageBuffer(
  buffer: Buffer,
  ownerId: string,
  namePrefix?: string,
) {
  assertOwnerId(ownerId);
  const { mimeType, ext } = await ensureImageBuffer(buffer);
  const safePrefix = (namePrefix || "asset")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .slice(0, 80);
  let writtenStorageKey: string | null = null;
  try {
    return await withUploadStorageLock("materials", ownerId, async () => {
      await assertMaterialStorageQuota(ownerId, buffer.byteLength);
      const root = getUploadDirectory("materials");
      const ownerDir = path.join(/* turbopackIgnore: true */ root, ownerId);
      await mkdir(ownerDir, { recursive: true, mode: 0o700 });
      const filename = `${safePrefix || "asset"}-${randomUUID()}.${ext}`;
      const storageKey = `${ownerId}/${filename}`;
      const absolutePath = resolveUploadStoragePath(root, storageKey);
      writtenStorageKey = storageKey;
      try {
        await writeFile(absolutePath, buffer, { mode: 0o600, flag: "wx" });
      } catch (error) {
        await deleteStoredUploadFile("materials", storageKey);
        writtenStorageKey = null;
        throw error;
      }
      return {
        url: materialFileUrl(storageKey),
        storageKey,
        mimeType,
        sizeBytes: buffer.byteLength,
      };
    });
  } catch (error) {
    if (writtenStorageKey) {
      await deleteStoredUploadFile("materials", writtenStorageKey);
    }
    throw error;
  }
}

export async function saveImageFromUrl(
  url: string,
  ownerId: string,
  options: {
    namePrefix?: string;
    allowedLocalStorageKey?: string | null;
  } = {},
) {
  let buffer: Buffer;
  if (url.startsWith("data:")) {
    if (url.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024) {
      throw new Error("图片不能超过 8MB");
    }
    const res = await fetch(url);
    const blob = await res.blob();
    buffer = Buffer.from(await blob.arrayBuffer());
  } else if (url.startsWith("/")) {
    const storageKey = materialStorageKeyFromUrl(url);
    if (!storageKey) throw new Error("本地图片路径不受支持");
    if (
      !materialStorageKeyBelongsToUser(storageKey, ownerId) &&
      options.allowedLocalStorageKey !== storageKey
    ) {
      throw new Error("无权读取该本地图片");
    }
    const stored = await findStoredUploadFile("materials", storageKey);
    if (!stored) throw new Error("无法读取本地图片");
    buffer = await readFile(/* turbopackIgnore: true */ stored.path);
  } else {
    const resource = await fetchPublicResource(url, {
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: 30_000,
      maxRedirects: 3,
    });
    buffer = resource.buffer;
  }
  return saveImageBuffer(buffer, ownerId, options.namePrefix);
}

export async function deleteStoredMaterialFile(storageKey: string | null) {
  if (!storageKey) return;
  await deleteStoredUploadFile("materials", storageKey);
}

export async function deleteStoredMaterialUrl(url: string | undefined) {
  if (!url) return;
  const storageKey = materialStorageKeyFromUrl(url);
  if (!storageKey) return;
  await deleteStoredMaterialFile(storageKey);
}
