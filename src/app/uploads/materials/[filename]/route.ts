import { readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function uploadsDir() {
  return path.join(process.cwd(), "public", "uploads", "materials");
}

function isSafeFilename(filename: string) {
  return /^[a-zA-Z0-9._-]+$/.test(filename) && !filename.includes("..");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);
  if (!isSafeFilename(decoded)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const ext = path.extname(decoded).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const absolutePath = path.join(uploadsDir(), decoded);
  const root = uploadsDir();
  if (!absolutePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const [file, info] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const decoded = decodeURIComponent(filename);
  if (!isSafeFilename(decoded)) return new Response(null, { status: 400 });

  const ext = path.extname(decoded).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) return new Response(null, { status: 400 });

  const absolutePath = path.join(uploadsDir(), decoded);
  const root = uploadsDir();
  if (!absolutePath.startsWith(root + path.sep)) return new Response(null, { status: 400 });

  try {
    const info = await stat(absolutePath);
    return new Response(null, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
