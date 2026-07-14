import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  feedbackStorageKeyBelongsToUser,
} from "@/lib/feedback";
import {
  findStoredUploadFile,
  parseUploadStorageKey,
} from "@/lib/upload-storage";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function notFound() {
  return Response.json(
    { error: "文件不存在" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

async function belongsToFeedback(storageKey: string, userId: string) {
  const row = await prisma.feedback.findFirst({
    where: {
      userId,
      screenshotUrls: { contains: storageKey },
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function serveFeedbackFile(
  storageKey: string,
  options: { head?: boolean } = {},
) {
  try {
    parseUploadStorageKey(storageKey);
  } catch {
    return notFound();
  }
  const session = await auth();
  if (!session?.user?.id) return notFound();
  const admin = session.user.role === "ADMIN";
  const pathOwner = feedbackStorageKeyBelongsToUser(
    storageKey,
    session.user.id,
  );
  const owner = admin
    ? false
    : pathOwner || (await belongsToFeedback(storageKey, session.user.id));
  if (!admin && !owner) return notFound();

  const stored = await findStoredUploadFile("feedback", storageKey);
  if (!stored) return notFound();
  const contentType = MIME_BY_EXTENSION[extname(stored.path).toLowerCase()];
  if (!contentType) return notFound();
  const headers = {
    "Content-Type": contentType,
    "Content-Length": String(stored.info.size),
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
  };
  if (options.head) return new Response(null, { headers });
  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ stored.path),
  ) as ReadableStream;
  return new Response(stream, { headers });
}
