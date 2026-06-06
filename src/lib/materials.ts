import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
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

function uploadsDir() {
  return path.join(process.cwd(), "public", "uploads", "materials");
}

function publicUrlFor(filename: string) {
  return `/uploads/materials/${filename}`;
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
    url: material.url,
    thumbnailUrl: material.thumbnailUrl,
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

function extensionForMime(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

function detectImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  return undefined;
}

async function ensureImageBuffer(buffer: Buffer, fallbackType?: string) {
  if (buffer.byteLength <= 0) throw new Error("图片内容为空");
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("图片不能超过 8MB");

  const detected = detectImageMime(buffer);
  const mimeType = detected ?? fallbackType ?? "image/png";
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw new Error("仅支持 PNG、JPG、WEBP、GIF 图片");
  }

  return { mimeType, ext: extensionForMime(mimeType) };
}

export async function saveImageBlob(blob: Blob, prefix: string) {
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { mimeType, ext } = await ensureImageBuffer(buffer, blob.type || undefined);
  await mkdir(uploadsDir(), { recursive: true });
  const filename = `${prefix}-${randomUUID()}.${ext}`;
  const absolutePath = path.join(uploadsDir(), filename);
  await writeFile(absolutePath, buffer);
  return {
    url: publicUrlFor(filename),
    storageKey: filename,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}

export async function saveImageFromUrl(url: string, prefix: string) {
  let blob: Blob;
  if (url.startsWith("data:")) {
    const res = await fetch(url);
    blob = await res.blob();
  } else if (url.startsWith("/")) {
    const relativePath = url.replace(/^\/+/, "").replace(/\?.*$/, "");
    const absolutePath = path.join(process.cwd(), "public", relativePath);
    const buffer = await readFile(absolutePath).catch(() => {
      throw new Error("无法读取本地图片");
    });
    const { mimeType } = await ensureImageBuffer(buffer);
    blob = new Blob([buffer], { type: mimeType });
  } else {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error("无法读取图片");
    blob = await res.blob();
  }
  return saveImageBlob(blob, prefix);
}

export async function deleteStoredMaterialFile(storageKey: string | null) {
  if (!storageKey) return;
  const absolutePath = path.join(uploadsDir(), storageKey);
  await unlink(absolutePath).catch(() => undefined);
}
