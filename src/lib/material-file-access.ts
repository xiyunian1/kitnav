import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  materialStorageKeyBelongsToUser,
} from "@/lib/materials";
import { isMaterialStorageKeyReferencedByUser } from "@/lib/material-storage-references";
import { isImageTurnStorageKeyAccessibleByUser } from "@/lib/image-result-retention";
import {
  findStoredUploadFile,
  parseUploadStorageKey,
} from "@/lib/upload-storage";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function notFound() {
  return Response.json(
    { error: "文件不存在" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

async function isApprovedPublicMaterial(storageKey: string) {
  const row = await prisma.material.findFirst({
    where: {
      visibility: "PUBLIC",
      status: "APPROVED",
      OR: [
        { storageKey },
        { storageKey: null, url: { endsWith: `/${storageKey}` } },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function serveMaterialFile(
  storageKey: string,
  options: { head?: boolean } = {},
) {
  try {
    parseUploadStorageKey(storageKey);
  } catch {
    return notFound();
  }

  const session = await auth();
  const pathOwner = Boolean(
    session?.user?.id &&
      materialStorageKeyBelongsToUser(storageKey, session.user.id),
  );
  const admin = session?.user?.role === "ADMIN";
  const userId = session?.user?.id;
  const [referencedByUser, activeImageResult] =
    userId && !admin
      ? await Promise.all([
          isMaterialStorageKeyReferencedByUser(storageKey, userId),
          pathOwner
            ? isImageTurnStorageKeyAccessibleByUser(storageKey, userId)
            : false,
        ])
      : [false, false];
  const owner = referencedByUser || activeImageResult;
  const publicMaterial = owner || admin
    ? false
    : await isApprovedPublicMaterial(storageKey);
  if (!owner && !admin && !publicMaterial) return notFound();

  const stored = await findStoredUploadFile("materials", storageKey);
  if (!stored) return notFound();
  const contentType = MIME_BY_EXTENSION[extname(stored.path).toLowerCase()];
  if (!contentType) return notFound();

  const headers = {
    "Content-Type": contentType,
    "Content-Length": String(stored.info.size),
    "Cache-Control": publicMaterial
      ? "public, max-age=300, must-revalidate"
      : "private, no-store",
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
