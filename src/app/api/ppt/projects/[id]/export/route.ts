import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { resolvePptProjectFile, safeDownloadName } from "@/lib/ppt-agent/paths";
import { isPptCompletedStatus } from "@/lib/ppt-agent/status";
import { arePptArtifactsExpired } from "@/lib/ppt-agent/project-public";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params;
  const project = await prisma.pptProject.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      status: true,
      pptxPath: true,
      completedAt: true,
      updatedAt: true,
      artifactsDeletedAt: true,
    },
  });

  if (project && arePptArtifactsExpired(project)) {
    return Response.json(
      { error: "该项目的生成文件已超过保留期限，请重新生成" },
      { status: 410 },
    );
  }
  if (!project || !isPptCompletedStatus(project.status) || !project.pptxPath) {
    return Response.json({ error: "项目不存在或尚未完成" }, { status: 404 });
  }

  let file: Awaited<ReturnType<typeof resolvePptProjectFile>>;
  try {
    file = await resolvePptProjectFile(project.id, project.pptxPath);
  } catch {
    return Response.json({ error: "项目文件路径无效" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadName(project.title))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
