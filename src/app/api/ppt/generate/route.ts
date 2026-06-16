import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeCredits, InsufficientCreditsError } from "@/lib/credits";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { generatePPT, type GenerationParams } from "@/lib/ppt-agent/generator";
import { resolvePptAgentBillingMode } from "@/lib/ppt-agent/billing";
import { getPptStyleLabel, getPptStylePreset, isPptStylePrompt } from "@/lib/ppt-agent/styles";
import { parsePromptMeta, parseTags } from "@/lib/materials";
import { isPptGenerationCancelled, registerPptGeneration } from "@/lib/ppt-agent/cancellation";
import { refundPptProjectCredits } from "@/lib/ppt-agent/refund";
import { listPptTemplateOptions } from "@/lib/ppt-agent/templates";

export const maxDuration = 600;
export const runtime = "nodejs";

const requestSchema = z
  .object({
    sourceType: z.enum(["topic", "markdown", "document", "url"]).optional(),
    prompt: z.string().trim().max(80000).optional(),
    sourceUrls: z.array(z.string().trim().url().max(1000)).max(10).optional(),
    sourceFileUrls: z.array(z.string().trim().max(2000)).max(10).optional(),
    sourceTopic: z.string().trim().max(4000).optional(),
    sourceMarkdown: z.string().trim().max(80000).optional(),
    sourceFileUrl: z.string().trim().max(2000).optional(),
    sourceUrl: z.string().trim().url().max(1000).optional(),
    template: z.string().trim().max(120).optional(),
    slideCount: z.coerce.number().int().min(3).max(30).default(10),
    aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
    style: z.string().trim().min(1).max(80).default("general"),
    styleMaterialId: z.string().trim().max(80).optional(),
    customStyle: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const hasCombinedInput = Boolean(
      data.prompt ||
        data.sourceUrls?.length ||
        data.sourceFileUrls?.length
    );
    if (hasCombinedInput) return;
    if (!data.sourceType) {
      ctx.addIssue({ code: "custom", path: ["prompt"], message: "请描述你想生成的 PPT，或添加网页/文件资料" });
      return;
    }
    if (data.sourceType === "topic" && !data.sourceTopic) {
      ctx.addIssue({ code: "custom", path: ["sourceTopic"], message: "请输入 PPT 主题" });
    }
    if (data.sourceType === "markdown" && !data.sourceMarkdown) {
      ctx.addIssue({ code: "custom", path: ["sourceMarkdown"], message: "请粘贴 Markdown 内容" });
    }
    if (data.sourceType === "document" && !data.sourceFileUrl) {
      ctx.addIssue({ code: "custom", path: ["sourceFileUrl"], message: "请先上传文档" });
    }
    if (data.sourceType === "url" && !data.sourceUrl) {
      ctx.addIssue({ code: "custom", path: ["sourceUrl"], message: "请输入网页 URL" });
    }
  });

const ACTIVE_STATUSES = ["PENDING", "QUEUED", "STRATEGIZING", "ACQUIRING_IMAGES", "EXECUTING", "EXPORTING"] as const;
const STALE_ACTIVE_PROJECT_MS = Number(process.env.PPT_STALE_ACTIVE_PROJECT_MS || 10 * 60 * 1000);

export async function POST(req: NextRequest) {
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

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await req.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "请求参数错误";
    return Response.json({ error: message || "请求参数错误" }, { status: 400 });
  }

  const activeProjects = await prisma.pptProject.findMany({
    where: {
      userId: session.user.id,
      status: { in: [...ACTIVE_STATUSES] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, logs: true, updatedAt: true },
  });

  const now = Date.now();
  for (const activeProject of activeProjects) {
    if (now - activeProject.updatedAt.getTime() > STALE_ACTIVE_PROJECT_MS) {
      await releaseStaleProject(activeProject.id, activeProject.logs);
      continue;
    }
    return Response.json(
      { error: "你已有一个 PPT 项目正在生成，请等待完成或先停止当前项目。" },
      { status: 429 }
    );
  }

  const billingMode = await resolvePptAgentBillingMode(session.user.id);
  const useOwnKey = billingMode.useOwnKey;
  const creditsCost = useOwnKey ? 0 : parsed.slideCount * Number(process.env.PPT_CREDITS_PER_SLIDE || 10);
  const title = buildTitle(parsed);
  const normalizedSourceType = resolveSourceType(parsed);
  let resolvedStyle: Awaited<ReturnType<typeof resolveStyleInput>>;
  let resolvedTemplate: string | undefined;
  try {
    resolvedStyle = await resolveStyleInput({
      userId: session.user.id,
      style: parsed.style,
      styleMaterialId: parsed.styleMaterialId,
      customStyle: parsed.customStyle,
    });
    resolvedTemplate = resolveTemplateInput(parsed.template);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PPT 风格或模板不可用" },
      { status: 400 }
    );
  }

  const project = await prisma.pptProject.create({
    data: {
      userId: session.user.id,
      title,
      topic: title,
      sourceText: parsed.prompt || (normalizedSourceType === "topic" ? parsed.sourceTopic : parsed.sourceMarkdown),
      language: "zh-CN",
      tone: "PROFESSIONAL",
      sourceType: normalizedSourceType.toUpperCase() as "TOPIC" | "MARKDOWN" | "DOCUMENT" | "URL",
      sourceTopic: parsed.sourceTopic,
      sourceMarkdown: parsed.sourceMarkdown,
      sourceFileUrl: parsed.sourceFileUrl,
      sourceUrl: parsed.sourceUrl,
      template: resolvedTemplate || resolvedStyle.template,
      slideCount: parsed.slideCount,
      aspectRatio: parsed.aspectRatio,
      style: resolvedStyle.style,
      projectPath: `projects/pending`,
      status: "PENDING",
      creditsCost,
      usedOwnKey: useOwnKey,
    },
  });

  await prisma.pptProject.update({
    where: { id: project.id },
    data: { projectPath: `projects/${project.id}` },
  });

  if (creditsCost > 0) {
    try {
      await consumeCredits(session.user.id, creditsCost, `PPT 生成预扣费（${parsed.slideCount} 页）`);
    } catch (error) {
      await prisma.pptProject.update({
        where: { id: project.id },
        data: { status: "FAILED", error: "积分不足", currentPhase: "扣费失败" },
      });
      const message =
        error instanceof InsufficientCreditsError
          ? `积分不足，需要 ${error.required}，当前 ${error.balance}`
          : error instanceof Error
            ? error.message
            : "积分不足";
      return Response.json({ error: message }, { status: 402 });
    }
  }

  let activeAbortController: AbortController | null = null;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let refunded = false;
      let closed = false;
      const abortController = new AbortController();
      activeAbortController = abortController;
      const unregister = registerPptGeneration(project.id, abortController);

      const emit = (type: string, data: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      emit("project", { projectId: project.id });

      try {
        const params: GenerationParams = {
          projectId: project.id,
          userId: session.user.id,
          sourceType: normalizedSourceType,
          sourceTopic: parsed.sourceTopic,
          sourceMarkdown: parsed.sourceMarkdown,
          sourceFileUrl: parsed.sourceFileUrl,
          sourceUrl: parsed.sourceUrl,
          prompt: parsed.prompt,
          sourceUrls: parsed.sourceUrls,
          sourceFileUrls: parsed.sourceFileUrls,
          template: resolvedTemplate || resolvedStyle.template,
          slideCount: parsed.slideCount,
          aspectRatio: parsed.aspectRatio,
          style: resolvedStyle.style,
          stylePrompt: resolvedStyle.stylePrompt,
          styleLabel: resolvedStyle.styleLabel,
          signal: abortController.signal,
        };

        await generatePPT(params, (event) => emit(event.type, event.data));
      } catch (error) {
        const cancelled = isPptGenerationCancelled(error);
        if (creditsCost > 0 && !refunded) {
          refunded = true;
          await refundPptProjectCredits(
            project.id,
            cancelled ? `PPT 生成停止退款（${project.id}）` : `PPT 生成失败退款（${project.id}）`
          ).catch(console.error);
        }
        emit(cancelled ? "cancelled" : "error", { message: formatGenerationError(error) });
      } finally {
        unregister();
        activeAbortController = null;
        closed = true;
        controller.close();
      }
    },
    cancel() {
      activeAbortController?.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function resolveTemplateInput(template?: string) {
  const value = template?.trim();
  if (!value || value === "none") return undefined;
  const allowed = new Set(listPptTemplateOptions().map((item) => item.value));
  if (!allowed.has(value)) {
    throw new Error("选择的 PPT 模板不可用。");
  }
  return value;
}

async function releaseStaleProject(projectId: string, logs: string | null) {
  await refundPptProjectCredits(projectId, `PPT 生成超时自动释放退款（${projectId}）`).catch(console.error);
  const line = `[${new Date().toISOString()}] 生成任务长时间无进度，已自动释放`;
  await prisma.pptProject.update({
    where: { id: projectId },
    data: {
      status: "FAILED",
      currentPhase: "生成超时，已自动释放",
      error: "生成任务长时间无进度，已自动释放，请重新生成。",
      logs: [logs, line].filter(Boolean).join("\n"),
    },
  });
}

function formatGenerationError(error: unknown) {
  if (isPptGenerationCancelled(error)) return "用户已停止生成";
  const message = error instanceof Error ? error.message : "PPT 生成失败";
  if (/上游返回\s*(401|403)|\b(401|403)\b/i.test(message)) {
    return `${message}。请检查 PPT API 设置里的 Base URL、API Key 和模型是否支持聊天补全接口。`;
  }
  if (/aborted due to timeout|timeout|超时/i.test(message)) {
    return `${message}。当前 PPT 模型响应超时，请减少页数、换更快的文本模型，或稍后重试。`;
  }
  return message;
}

function resolveSourceType(input: z.infer<typeof requestSchema>): "topic" | "markdown" | "document" | "url" {
  if (input.prompt || input.sourceUrls?.length || input.sourceFileUrls?.length) return "markdown";
  return input.sourceType || "topic";
}

function buildTitle(input: z.infer<typeof requestSchema>) {
  if (input.prompt) {
    return input.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "未命名 PPT";
  }
  if (input.sourceUrls?.[0]) return input.sourceUrls[0];
  if (input.sourceFileUrls?.[0]) return input.sourceFileUrls[0].split(/[\\/]/).pop() || "未命名 PPT";
  const text =
    input.sourceType === "topic"
      ? input.sourceTopic
      : input.sourceType === "url"
        ? input.sourceUrl
        : input.sourceType === "document"
          ? input.sourceFileUrl?.split(/[\\/]/).pop()
          : input.sourceMarkdown;
  return (text || "未命名 PPT")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

async function resolveStyleInput(input: {
  userId: string;
  style: string;
  styleMaterialId?: string;
  customStyle?: string;
}) {
  const customStyle = input.customStyle?.trim();
  if (customStyle) {
    return {
      style: "custom",
      template: "custom-style",
      styleLabel: "自定义风格",
      stylePrompt: customStyle,
    };
  }

  if (input.styleMaterialId) {
    const material = await prisma.material.findFirst({
      where: {
        id: input.styleMaterialId,
        type: "PROMPT",
        OR: [
          { ownerId: input.userId },
          {
            visibility: "PUBLIC",
            status: "APPROVED",
          },
        ],
      },
      select: {
        id: true,
        title: true,
        tags: true,
        promptText: true,
        promptMeta: true,
      },
    });
    if (!material?.promptText) {
      throw new Error("选择的 PPT 风格不存在，请先在素材广场收藏或在素材库创建。");
    }
    const meta = parsePromptMeta(material.promptMeta);
    if (!isPptStylePrompt(meta, parseTags(material.tags))) {
      throw new Error("选择的素材不是 PPT 风格，请在素材库中新建“PPT 风格”提示词。");
    }
    return {
      style: `material:${material.id}`,
      template: `style-material:${material.id}`,
      styleLabel: material.title,
      stylePrompt: material.promptText,
    };
  }

  const preset = getPptStylePreset(input.style);
  return {
    style: preset.id,
    template: undefined,
    styleLabel: getPptStyleLabel(preset.id),
    stylePrompt: preset.prompt,
  };
}
