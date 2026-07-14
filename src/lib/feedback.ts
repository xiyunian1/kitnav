import { mkdir, readdir, stat, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { validateImageFile } from "@/lib/image-file-validation";
import {
  deleteStoredUploadFile,
  getUploadDirectory,
  parseUploadStorageKey,
  resolveUploadStoragePath,
  uploadDirectories,
} from "@/lib/upload-storage";
import { withUploadStorageLock } from "@/lib/upload-storage-lock";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOTS = 3;
const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function assertUserId(userId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
    throw new Error("无效的用户标识");
  }
}

export function feedbackFileUrl(storageKey: string) {
  parseUploadStorageKey(storageKey);
  return `/api/files/feedback/${storageKey
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function feedbackStorageKeyFromUrl(url: string) {
  let pathname: string;
  try {
    pathname = new URL(url, "http://local.invalid").pathname;
  } catch {
    return null;
  }
  const prefixes = ["/api/files/feedback/", "/uploads/feedback/"];
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

export function feedbackStorageKeyBelongsToUser(
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

async function assertFeedbackStorageQuota(userId: string, incomingBytes: number) {
  const maxBytes = positiveIntegerEnv(
    "FEEDBACK_USER_QUOTA_BYTES",
    100 * 1024 * 1024,
  );
  const maxFiles = positiveIntegerEnv("FEEDBACK_USER_MAX_FILES", 100);
  let files = 0;
  let bytes = 0;
  for (const root of uploadDirectories("feedback")) {
    const ownerDir = path.join(/* turbopackIgnore: true */ root, userId);
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
    const paths = [
      ...ownerFiles
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(ownerDir, entry.name)),
      ...legacyFiles
        .filter(
          (entry) => entry.isFile() && entry.name.startsWith(`${userId}-`),
        )
        .map((entry) => path.join(root, entry.name)),
    ];
    files += paths.length;
    for (const file of paths) bytes += (await stat(file)).size;
  }
  if (files >= maxFiles || bytes + incomingBytes > maxBytes) {
    throw new Error("反馈截图存储空间已达上限");
  }
}

export function parseScreenshotUrls(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => String(item))
        .filter(Boolean)
        .map((url) => {
          const storageKey = feedbackStorageKeyFromUrl(url);
          return storageKey ? feedbackFileUrl(storageKey) : url;
        })
        .slice(0, MAX_SCREENSHOTS);
    }
  } catch {
    return [];
  }
  return [];
}

export async function saveFeedbackScreenshots(files: File[], userId: string) {
  assertUserId(userId);
  const usableFiles = files.filter((file) => file.size > 0).slice(0, MAX_SCREENSHOTS);
  if (files.filter((file) => file.size > 0).length > MAX_SCREENSHOTS) {
    throw new Error("截图最多上传 3 张");
  }

  const root = getUploadDirectory("feedback");
  const ownerDir = path.join(/* turbopackIgnore: true */ root, userId);
  await mkdir(ownerDir, { recursive: true, mode: 0o700 });
  const prepared = await Promise.all(
    usableFiles.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
        throw new Error("单张截图不能超过 5MB");
      }

      const image = await validateImageFile(buffer, {
        allowedMimeTypes: ALLOWED_SCREENSHOT_TYPES,
        invalidMessage: "截图内容无效或已损坏",
        unsupportedMessage: "截图仅支持 PNG、JPG、WEBP",
        limitMessage: "截图像素尺寸过大",
      });
      return { buffer, extension: image.extension };
    }),
  );

  const urls: string[] = [];
  try {
    return await withUploadStorageLock("feedback", userId, async () => {
      try {
        for (const { buffer, extension } of prepared) {
          await assertFeedbackStorageQuota(userId, buffer.byteLength);

          const filename = `${randomUUID()}.${extension}`;
          const storageKey = `${userId}/${filename}`;
          const destination = resolveUploadStoragePath(root, storageKey);
          await writeFile(destination, buffer, { mode: 0o600, flag: "wx" });
          urls.push(feedbackFileUrl(storageKey));
        }
        return [...urls];
      } catch (error) {
        await deleteFeedbackScreenshots(urls);
        urls.length = 0;
        throw error;
      }
    });
  } catch (error) {
    await deleteFeedbackScreenshots(urls);
    throw error;
  }
}

export async function deleteFeedbackScreenshots(urls: string[]) {
  await Promise.all(
    urls.map(async (url) => {
      const storageKey = feedbackStorageKeyFromUrl(url);
      if (storageKey) await deleteStoredUploadFile("feedback", storageKey);
    }),
  );
}
