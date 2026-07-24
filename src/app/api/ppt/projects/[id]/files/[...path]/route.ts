import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { extname } from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { resolvePptProjectFile } from "@/lib/ppt-agent/paths";
import {
  sanitizeSvgForBrowser,
  SVG_BROWSER_CONTENT_SECURITY_POLICY,
} from "@/lib/ppt-agent/svg-browser-safety";
import { arePptArtifactsExpired } from "@/lib/ppt-agent/project-public";

const ALLOWED_PREFIXES = ["svg_output/", "svg_final/", "images/", "audio/", "templates/imported/svg/", "templates/imported/svg-flat/"];
const MAX_BROWSER_SVG_BYTES = 10 * 1024 * 1024;
export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertControlledModuleAvailableForUser("ppt", session.user.id);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PPT 模块不可用" },
      { status: 403 }
    );
  }

  const { id, path } = await params;
  const relativePath = path.join("/");
  if (
    relativePath.includes("..") ||
    relativePath.startsWith("/") ||
    !ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
  ) {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }

  const project = await prisma.pptProject.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      status: true,
      completedAt: true,
      updatedAt: true,
      artifactsDeletedAt: true,
    },
  });
  if (!project) return Response.json({ error: "文件不存在" }, { status: 404 });
  if (arePptArtifactsExpired(project)) {
    return Response.json(
      { error: "该项目的生成文件已超过 7 天保留期" },
      { status: 410 },
    );
  }

  const ext = extname(relativePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return Response.json({ error: "文件不存在" }, { status: 404 });

  let file: Awaited<ReturnType<typeof resolvePptProjectFile>>;
  try {
    file = await resolvePptProjectFile(id, relativePath);
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }

  try {
    if (ext === ".svg" && file.size > MAX_BROWSER_SVG_BYTES) {
      return Response.json({ error: "文件过大" }, { status: 413 });
    }
    const body =
      ext === ".svg"
        ? sanitizeSvgForBrowser(
            (await readFile(file.path)).toString("utf-8"),
          )
        : (Readable.toWeb(createReadStream(file.path)) as ReadableStream);
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        ...(ext === ".svg" ? {} : { "Content-Length": String(file.size) }),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        ...(ext === ".svg"
          ? { "Content-Security-Policy": SVG_BROWSER_CONTENT_SECURITY_POLICY }
          : {}),
      },
    });
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }
}
