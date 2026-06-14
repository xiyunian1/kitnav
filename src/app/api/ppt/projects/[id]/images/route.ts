import { prisma } from "@/lib/db";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import { listProjectImages, readImagePromptArtifacts, saveProjectImage } from "@/lib/ppt-agent/project-tools";
import { appendProjectLog, authorizeEditablePptProject } from "../../_utils";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const projectDir = getPptProjectDir(project.id);
  return Response.json({
    ...readImagePromptArtifacts(projectDir),
    images: listProjectImages(projectDir),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "请上传图片文件" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: "图片不能超过 10MB" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = saveProjectImage(getPptProjectDir(project.id), file.name, buffer);
    await prisma.pptProject.update({
      where: { id: project.id },
      data: {
        currentPhase: "已补充图片素材，等待重新导出",
        logs: appendProjectLog(project.logs, `已上传 PPT 图片素材：${filename}`),
      },
    });
    return Response.json({ filename });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "图片上传失败" },
      { status: 500 }
    );
  }
}
