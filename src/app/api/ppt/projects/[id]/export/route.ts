import { readFile } from "fs/promises";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { assertInsidePptProject, safeDownloadName } from "@/lib/ppt-agent/paths";

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
    select: { id: true, title: true, status: true, pptxPath: true },
  });

  if (!project || project.status !== "COMPLETED" || !project.pptxPath) {
    return Response.json({ error: "项目不存在或尚未完成" }, { status: 404 });
  }

  let filePath: string;
  try {
    filePath = assertInsidePptProject(project.id, project.pptxPath);
  } catch {
    return Response.json({ error: "项目文件路径无效" }, { status: 404 });
  }

  try {
    const file = await readFile(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeDownloadName(project.title))}`,
      },
    });
  } catch {
    return Response.json({ error: "文件不存在" }, { status: 404 });
  }
}
