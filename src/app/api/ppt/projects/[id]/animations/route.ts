import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import {
  ANIMATION_EFFECTS,
  ANIMATION_TRIGGERS,
  TRANSITION_EFFECTS,
  listAnimationGroups,
  readAnimationSettings,
  writeAnimationSettings,
} from "@/lib/ppt-agent/project-tools";
import { appendProjectLog, authorizeEditablePptProject } from "../../_utils";

export const runtime = "nodejs";

const schema = z.object({
  transition: z.enum(TRANSITION_EFFECTS),
  transitionDuration: z.coerce.number().min(0.1).max(5),
  animation: z.enum(ANIMATION_EFFECTS),
  animationTrigger: z.enum(ANIMATION_TRIGGERS),
  animationDuration: z.coerce.number().min(0.1).max(5),
  animationStagger: z.coerce.number().min(0).max(5),
  autoAdvance: z.coerce.number().min(0.5).max(120).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const projectDir = getPptProjectDir(project.id);
  const [groups] = await Promise.all([
    listAnimationGroups(projectDir).catch(() => []),
  ]);
  return Response.json({
    settings: readAnimationSettings(projectDir),
    groups,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(await req.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "请求参数错误";
    return Response.json({ error: message || "请求参数错误" }, { status: 400 });
  }

  try {
    const settings = await writeAnimationSettings(getPptProjectDir(project.id), parsed);
    await prisma.pptProject.update({
      where: { id: project.id },
      data: {
        currentPhase: "已更新动画配置，等待重新导出",
        logs: appendProjectLog(project.logs, "已更新 PPT 动画配置"),
      },
    });
    return Response.json({ settings });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "动画配置保存失败" },
      { status: 500 }
    );
  }
}
