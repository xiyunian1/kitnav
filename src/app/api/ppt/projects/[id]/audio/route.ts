import { z } from "zod";
import { prisma } from "@/lib/db";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import {
  AUDIO_PROVIDERS,
  generateNarrationAudio,
  listAudioFiles,
  listCommonVoices,
  readAudioSettings,
} from "@/lib/ppt-agent/project-tools";
import { appendProjectLog, authorizeEditablePptProject } from "../../_utils";

export const runtime = "nodejs";
export const maxDuration = 600;

const schema = z.object({
  provider: z.enum(AUDIO_PROVIDERS),
  voice: z.string().trim().min(1).max(120),
  voiceId: z.string().trim().max(160).optional(),
  rate: z.string().trim().regex(/^[+-]\d{1,3}%$/).default("+0%"),
  locale: z.string().trim().max(20).default("zh-CN"),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const project = await authorizeEditablePptProject(params);
  if (project instanceof Response) return project;

  const projectDir = getPptProjectDir(project.id);
  const voices = await listCommonVoices("zh-CN").catch(() => []);
  return Response.json({
    settings: readAudioSettings(projectDir),
    files: listAudioFiles(projectDir),
    voices,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const result = await generateNarrationAudio(getPptProjectDir(project.id), parsed);
    await prisma.pptProject.update({
      where: { id: project.id },
      data: {
        currentPhase: "已生成旁白音频，等待重新导出",
        logs: appendProjectLog(project.logs, "已生成 PPT 旁白音频"),
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "旁白音频生成失败" },
      { status: 500 }
    );
  }
}
