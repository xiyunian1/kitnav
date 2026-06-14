import { writeFileSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { pptSemaphore } from "./semaphore";
import { getPptProjectDir, publicProjectUrl } from "./paths";
import { runPptMasterAgent } from "./agent-runner";
import { runConfiguredPptAgent } from "./configured-runner";
import { runHostedPptAgent } from "./hosted-agent-runner";
import { clampSlideCount, ensureProjectStructure, resolveSourceMarkdown } from "./project-utils";
import { buildPptStyleInstruction, getPptStyleLabel } from "./styles";
import { isPptGenerationCancelled, throwIfPptCancelled } from "./cancellation";
import { collectPptArtifactPaths } from "./artifacts";

export interface GenerationParams {
  projectId: string;
  userId: string;
  sourceType: "topic" | "document" | "url" | "markdown";
  sourceTopic?: string;
  sourceFileUrl?: string;
  sourceUrl?: string;
  sourceMarkdown?: string;
  template?: string;
  slideCount?: number;
  aspectRatio?: string;
  style?: string;
  stylePrompt?: string;
  styleLabel?: string;
  signal?: AbortSignal;
}

export interface GenerationEvent {
  type: "phase" | "progress" | "log" | "preview" | "error" | "complete";
  data: Record<string, unknown>;
}

export type EventEmitter = (event: GenerationEvent) => void;

export async function generatePPT(params: GenerationParams, emit: EventEmitter): Promise<void> {
  const requestedSlideCount = clampSlideCount(params.slideCount ?? 10);
  const aspectRatio = params.aspectRatio === "4:3" ? "4:3" : "16:9";
  const canvasFormat = aspectRatio === "4:3" ? "ppt43" : "ppt169";
  const projectDir = getPptProjectDir(params.projectId);

  await pptSemaphore.acquire();

  try {
    throwIfPptCancelled(params.signal);
    await log(params.projectId, emit, "初始化 PPT Master 项目目录");
    emit({ type: "phase", data: { phase: "PENDING", progress: 0 } });
    await updateProject(params.projectId, {
      status: "PENDING",
      currentPhase: "初始化项目",
      progress: 0,
    });

    ensureProjectStructure(projectDir, params.projectId, canvasFormat);
    throwIfPptCancelled(params.signal);

    const sourceMd = await resolveSourceMarkdown(params, projectDir);
    writeFileSync(join(projectDir, "sources", "source.md"), sourceMd, "utf-8");

    const runnerOptions: {
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
    } = {
      projectDir,
      sourceMd,
      slideCount: requestedSlideCount,
      aspectRatio,
      canvasFormat,
      style: params.style || "general",
      stylePrompt: buildPptStyleInstruction({
        style: params.style,
        stylePrompt: params.stylePrompt,
        styleLabel: params.styleLabel,
      }),
      styleLabel: getPptStyleLabel(params.style, params.styleLabel),
      signal: params.signal,
      emit,
    };
    throwIfPptCancelled(params.signal);
    const agentMode = process.env.PPT_AGENT_MODE?.trim() || "hosted";
    await log(
      params.projectId,
      emit,
      agentMode === "cli"
        ? "交给 PPT Master CLI agent 执行完整工作流"
        : agentMode === "simple"
          ? "使用站内 PPT API 配置执行简化生成流程"
          : "使用站内 PPT Master agent 执行完整工具工作流"
    );
    const result =
      agentMode === "cli"
        ? await runPptMasterAgent(params, runnerOptions)
        : agentMode === "simple"
          ? await runConfiguredPptAgent(params, runnerOptions)
          : await runHostedPptAgent(params, runnerOptions);
    const pptxUrl = publicProjectUrl(params.projectId, result.pptxPath);

    await updateProject(params.projectId, {
      status: "COMPLETED",
      currentPhase: "生成完成",
      ...collectPptArtifactPaths(projectDir, result.pptxPath),
      slideCount: result.slideCount,
      progress: 100,
      completedAt: new Date(),
    });

    emit({ type: "complete", data: { projectId: params.projectId, pptxUrl } });
  } catch (error) {
    const cancelled = isPptGenerationCancelled(error);
    const message = cancelled ? "用户已停止生成" : error instanceof Error ? error.message : "PPT 生成失败";
    await updateProject(params.projectId, {
      status: "FAILED",
      currentPhase: cancelled ? "已停止生成" : "生成失败",
      error: message,
    });
    throw error;
  } finally {
    pptSemaphore.release();
  }
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

async function updateProject(projectId: string, data: Parameters<typeof prisma.pptProject.update>[0]["data"]) {
  await prisma.pptProject.update({ where: { id: projectId }, data });
}
