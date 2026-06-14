import { prisma } from "@/lib/db";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import { importPptxTemplate, readImportedTemplate } from "@/lib/ppt-agent/project-tools";
import { appendProjectLog, authorizeEditablePptProject } from "../../_utils";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  return Response.json(readImportedTemplate(getPptProjectDir(project.id)));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "请上传 PPTX 模板文件" }, { status: 400 });
  }
  if (file.size > 30 * 1024 * 1024) {
    return Response.json({ error: "模板文件不能超过 30MB" }, { status: 400 });
  }

  try {
    const result = await importPptxTemplate(getPptProjectDir(project.id), file.name, Buffer.from(await file.arrayBuffer()));
    await prisma.pptProject.update({
      where: { id: project.id },
      data: {
        currentPhase: "已导入 PPTX 模板参考",
        logs: appendProjectLog(project.logs, `已导入 PPTX 模板：${result.filename}`),
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "模板导入失败" },
      { status: 500 }
    );
  }
}
