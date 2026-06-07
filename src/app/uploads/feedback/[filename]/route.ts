import { readFile, stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function uploadsDir() {
  return path.join(process.cwd(), "public", "uploads", "feedback");
}

function isSafeFilename(filename: string) {
  return /^[a-zA-Z0-9._-]+$/.test(filename) && !filename.includes("..");
}

async function serveFile(filename: string, head = false) {
  const decoded = decodeURIComponent(filename);
  if (!isSafeFilename(decoded)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const ext = path.extname(decoded).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const root = uploadsDir();
  const absolutePath = path.join(root, decoded);
  if (!absolutePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const info = await stat(absolutePath);
    const headers = {
      "Content-Type": contentType,
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=86400",
    };
    if (head) return new Response(null, { headers });
    const file = await readFile(absolutePath);
    return new Response(file, { headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  return serveFile(filename);
}

export async function HEAD(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  return serveFile(filename, true);
}
