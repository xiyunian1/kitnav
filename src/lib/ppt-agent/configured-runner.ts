import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { checkSvgQuality, convertSvgToPptx, finalizeSvg, splitNotes } from "./python-tools";
import { publicProjectUrl } from "./paths";
import { runExecutor, runStrategist, type AgentContext } from "./orchestrator";
import { resolvePptTextProvider } from "./resolve-claude";
import { throwIfPptCancelled } from "./cancellation";
import type { EventEmitter, GenerationParams } from "./generator";

export interface ConfiguredAgentRunResult {
  pptxPath: string;
  slideCount: number;
}

interface RunnerOptions {
  projectDir: string;
  sourceMd: string;
  slideCount: number;
  aspectRatio: "16:9" | "4:3";
  canvasFormat: "ppt169" | "ppt43";
  style: string;
  stylePrompt: string;
  styleLabel: string;
  signal?: AbortSignal;
  emit: EventEmitter;
}

export async function runConfiguredPptAgent(
  params: GenerationParams,
  options: RunnerOptions
): Promise<ConfiguredAgentRunResult> {
  const resolved = await resolvePptTextProvider(params.userId);
  throwIfPptCancelled(options.signal);
  await log(
    params.projectId,
    options.emit,
    `使用站内 PPT API 配置生成：${resolved.source === "user" ? "用户自带 Key" : "平台上游"} / ${resolved.model}`
  );
  await log(params.projectId, options.emit, `画布格式：${options.canvasFormat}，目标页数：${options.slideCount}`);
  await log(params.projectId, options.emit, `生成风格：${options.styleLabel}`);

  const context: AgentContext = {
    projectPath: options.projectDir,
    sourceMd: options.sourceMd,
    template: params.template,
    slideCount: options.slideCount,
    aspectRatio: options.aspectRatio,
    style: options.style,
    stylePrompt: options.stylePrompt,
    styleLabel: options.styleLabel,
    userId: params.userId,
    provider: resolved.provider,
    useTools: process.env.PPT_AGENT_API_TOOLS === "true",
    signal: options.signal,
  };

  options.emit({ type: "phase", data: { phase: "STRATEGIZING", progress: 12 } });
  await updateProject(params.projectId, {
    status: "STRATEGIZING",
    currentPhase: "生成设计规格",
    progress: 12,
  });
  await log(params.projectId, options.emit, "Strategist 正在生成 design_spec.md 和 spec_lock.md");
  throwIfPptCancelled(options.signal);
  const stopStrategistHeartbeat = startStrategistHeartbeat(params.projectId, options.emit, options.signal);
  let strategist: Awaited<ReturnType<typeof runStrategist>>;
  try {
    strategist = await runStrategist(context);
  } finally {
    stopStrategistHeartbeat();
  }
  const slideCount = Math.max(1, Math.min(options.slideCount, strategist.slideCount || options.slideCount));

  await updateProject(params.projectId, {
    specPath: join(options.projectDir, "design_spec.md"),
    specLockPath: join(options.projectDir, "spec_lock.md"),
    slideCount,
    progress: 25,
  });

  options.emit({ type: "phase", data: { phase: "EXECUTING", progress: 30 } });
  await updateProject(params.projectId, {
    status: "EXECUTING",
    currentPhase: "逐页生成 SVG",
    progress: 30,
  });

  const previousPages: string[] = [];
  for (let pageIndex = 0; pageIndex < slideCount; pageIndex++) {
    throwIfPptCancelled(options.signal);
    const progress = 30 + Math.floor((pageIndex / slideCount) * 45);
    await updateProject(params.projectId, { progress });
    options.emit({ type: "progress", data: { progress } });
    await log(params.projectId, options.emit, `生成第 ${pageIndex + 1}/${slideCount} 页 SVG`);

    const page = await runExecutor(context, pageIndex, slideCount, previousPages);
    previousPages.push(page.svg);
    options.emit({
      type: "preview",
      data: {
        pageIndex,
        svgUrl: `/api/ppt/projects/${params.projectId}/files/svg_output/${String(pageIndex + 1).padStart(2, "0")}_slide.svg`,
      },
    });
  }

  await updateProject(params.projectId, {
    svgOutputPath: join(options.projectDir, "svg_output"),
    progress: 78,
  });
  await writeFallbackSpeakerNotes(options.projectDir, slideCount);
  throwIfPptCancelled(options.signal);

  options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 85 } });
  await updateProject(params.projectId, {
    status: "EXPORTING",
    currentPhase: "质量检查与导出 PPTX",
    progress: 85,
  });

  const quality = await checkSvgQuality(options.projectDir);
  if (quality.errors.length > 0) {
    throw new Error(`SVG 质量检查失败：${quality.errors.slice(0, 6).join("; ")}`);
  }

  await log(params.projectId, options.emit, "SVG 质量检查通过，开始导出 PPTX");
  throwIfPptCancelled(options.signal);
  await splitNotes(options.projectDir).catch(() => undefined);
  await finalizeSvg(options.projectDir);
  const pptxPath = await convertSvgToPptx(options.projectDir);
  const finalPath = existsSync(pptxPath) ? pptxPath : findLatestPptx(options.projectDir);
  if (!finalPath) {
    throw new Error("PPTX 导出失败：exports/ 下未找到 PPTX 文件。");
  }

  await log(params.projectId, options.emit, `PPTX 已生成：${publicProjectUrl(params.projectId, finalPath)}`);
  return { pptxPath: finalPath, slideCount };
}

async function writeFallbackSpeakerNotes(projectDir: string, slideCount: number) {
  const notesDir = join(projectDir, "notes");
  mkdirSync(notesDir, { recursive: true });
  const designSpec = existsSync(join(projectDir, "design_spec.md"))
    ? readFileSync(join(projectDir, "design_spec.md"), "utf-8")
    : "";
  const total = Array.from({ length: slideCount }, (_, index) => {
    const stem = `${String(index + 1).padStart(2, "0")}_slide`;
    return [
      `# ${stem}`,
      "",
      buildNoteText(designSpec, index + 1),
      "",
    ].join("\n");
  }).join("\n");
  writeFileSync(join(notesDir, "total.md"), total, "utf-8");
}

function buildNoteText(designSpec: string, slideNo: number) {
  const match = designSpec.match(
    new RegExp(`(?:Slide|Page|第)\\s*${slideNo}[^\\n]*\\n([\\s\\S]{0,600}?)(?=\\n(?:#+\\s*)?(?:Slide|Page|第)\\s*\\d+|$)`, "i")
  );
  const source = (match?.[1] || "").replace(/\s+/g, " ").trim();
  if (source) return `这一页围绕第 ${slideNo} 部分展开。讲解时先点明本页结论，再结合页面中的结构和关键词说明：${source.slice(0, 260)}`;
  return `这一页围绕第 ${slideNo} 部分展开。讲解时先点明本页结论，再顺着页面结构解释关键概念、关系和行动建议。`;
}

function findLatestPptx(projectDir: string) {
  const exportsDir = join(projectDir, "exports");
  if (!existsSync(exportsDir)) return "";
  const files = readdirSync(exportsDir)
    .filter((file) => file.toLowerCase().endsWith(".pptx") && !file.toLowerCase().endsWith("_svg.pptx"))
    .map((file) => join(exportsDir, file))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || "";
}

async function log(projectId: string, emit: EventEmitter, message: string) {
  emit({ type: "log", data: { message } });
  const line = `[${new Date().toISOString()}] ${message}`;
  const current = await prisma.pptProject.findUnique({
    where: { id: projectId },
    select: { logs: true },
  });
  await prisma.pptProject.update({
    where: { id: projectId },
    data: { logs: [current?.logs, line].filter(Boolean).join("\n") },
  });
}

function startStrategistHeartbeat(projectId: string, emit: EventEmitter, signal?: AbortSignal) {
  let ticks = 0;
  const timer = setInterval(() => {
    if (signal?.aborted) {
      clearInterval(timer);
      return;
    }
    ticks += 1;
    const progress = Math.min(24, 12 + ticks * 2);
    emit({ type: "progress", data: { progress } });
    updateProject(projectId, {
      currentPhase: "生成设计规格（模型响应中）",
      progress,
    }).catch(console.error);
  }, 15_000);

  return () => clearInterval(timer);
}

async function updateProject(projectId: string, data: Parameters<typeof prisma.pptProject.update>[0]["data"]) {
  await prisma.pptProject.update({ where: { id: projectId }, data });
}
