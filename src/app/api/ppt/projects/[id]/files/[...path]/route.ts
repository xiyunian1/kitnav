import { readFile } from "fs/promises";
import { extname } from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { assertInsidePptProject } from "@/lib/ppt-agent/paths";

const ALLOWED_PREFIXES = ["svg_output/", "svg_final/", "images/", "audio/", "templates/imported/svg/", "templates/imported/svg-flat/"];
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
    select: { id: true },
  });
  if (!project) return Response.json({ error: "文件不存在" }, { status: 404 });

  const ext = extname(relativePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) return Response.json({ error: "文件不存在" }, { status: 404 });

  let filePath: string;
  try {
    filePath = assertInsidePptProject(id, relativePath);
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }

  try {
    const file = await readFile(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }
}
