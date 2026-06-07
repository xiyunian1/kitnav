import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOTS = 3;
const ALLOWED_SCREENSHOT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function uploadsDir() {
  return path.join(process.cwd(), "public", "uploads", "feedback");
}

function publicUrlFor(filename: string) {
  return `/uploads/feedback/${filename}`;
}

function extensionForMime(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return "png";
  }
}

function detectImageMime(buffer: Buffer): string | undefined {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
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
  return undefined;
}

export function parseScreenshotUrls(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean).slice(0, MAX_SCREENSHOTS);
    }
  } catch {
    return [];
  }
  return [];
}

export async function saveFeedbackScreenshots(files: File[], userId: string) {
  const usableFiles = files.filter((file) => file.size > 0).slice(0, MAX_SCREENSHOTS);
  if (files.filter((file) => file.size > 0).length > MAX_SCREENSHOTS) {
    throw new Error("截图最多上传 3 张");
  }

  const urls: string[] = [];
  await mkdir(uploadsDir(), { recursive: true });

  for (const file of usableFiles) {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error("单张截图不能超过 5MB");
    }

    const mimeType = detectImageMime(buffer) ?? file.type;
    if (!ALLOWED_SCREENSHOT_TYPES.has(mimeType)) {
      throw new Error("截图仅支持 PNG、JPG、WEBP");
    }

    const filename = `${userId}-${randomUUID()}.${extensionForMime(mimeType)}`;
    await writeFile(path.join(uploadsDir(), filename), buffer);
    urls.push(publicUrlFor(filename));
  }

  return urls;
}
