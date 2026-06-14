import { prisma } from "@/lib/db";
import { collectPptArtifactPaths, normalizePptSvgArtifacts } from "@/lib/ppt-agent/artifacts";
import { getPptProjectDir, publicProjectUrl } from "@/lib/ppt-agent/paths";
import { checkSvgQuality, convertSvgToPptx, finalizeSvg, splitNotes } from "@/lib/ppt-agent/python-tools";
import { authorizeEditablePptProject } from "../../_utils";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const projectDir = getPptProjectDir(project.id);
  await prisma.pptProject.update({
    where: { id: project.id },
    data: { status: "EXPORTING", currentPhase: "重新导出 PPTX", progress: 90, error: null },
  });

  try {
    normalizePptSvgArtifacts(projectDir);
    const quality = await checkSvgQuality(projectDir);
    if (quality.errors.length > 0) {
      throw new Error(`SVG 质量检查失败：${quality.errors.slice(0, 8).join("; ")}`);
    }
    await splitNotes(projectDir).catch(() => undefined);
    await finalizeSvg(projectDir);
    const pptxPath = await convertSvgToPptx(projectDir);
    await prisma.pptProject.update({
      where: { id: project.id },
      data: {
        status: "COMPLETED",
        currentPhase: "重新导出完成",
        ...collectPptArtifactPaths(projectDir, pptxPath),
        progress: 100,
        completedAt: new Date(),
      },
    });
    return Response.json({ ok: true, pptxUrl: publicProjectUrl(project.id, pptxPath) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重新导出失败";
    await prisma.pptProject.update({
      where: { id: project.id },
      data: { status: "FAILED", currentPhase: "重新导出失败", error: message },
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
