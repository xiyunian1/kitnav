import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";
import { resolvePptTextProvider } from "./resolve-claude";
import { buildPptStyleInstruction } from "./styles";
import { isPptGenerationCancelled, throwIfPptCancelled } from "./cancellation";
import type { OpenAITextProvider, TextMessage } from "@/lib/providers/text-openai";

export interface AgentContext {
  projectPath: string;
  sourceMd: string;
  template?: string;
  slideCount?: number;
  aspectRatio?: string;
  style?: string;
  stylePrompt?: string;
  styleLabel?: string;
  userId: string;
  provider?: OpenAITextProvider;
  useTools?: boolean;
  signal?: AbortSignal;
  onRetry?: (message: string) => void | Promise<void>;
}

export interface StrategistResult {
  designSpec: string;
  specLock: string;
  slideCount: number;
}

export interface ExecutorResult {
  svg: string;
  pageIndex: number;
}

function loadRolePrompt(role: "strategist" | "executor-base" | "executor-general" | "executor-consultant" | "executor-consultant-top" | "shared-standards") {
  const path = join(getPptMasterSkillDir(), "references", `${role}.md`);
  if (!existsSync(path)) {
    throw new Error(`PPT Master role definition not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

export async function runStrategist(context: AgentContext): Promise<StrategistResult> {
  throwIfPptCancelled(context.signal);
  const provider = context.provider || (await resolvePptTextProvider(context.userId)).provider;
  const targetSlideCount = clampSlideCount(context.slideCount ?? 10);
  const styleInstruction = buildPptStyleInstruction(context);
  const sourceLimit = Number(process.env.PPT_AGENT_STRATEGIST_SOURCE_CHARS || 9000);
  const maxTokens = Number(
    process.env.PPT_AGENT_STRATEGIST_MAX_TOKENS ||
      Math.min(9000, Math.max(3200, targetSlideCount * 280 + 1400))
  );

  const userMessage = `
请为一个 PPT 生成任务产出紧凑但完整的中文规划 JSON。

项目路径：${context.projectPath}
画布：${context.aspectRatio || "16:9"}
目标页数：${targetSlideCount}
风格：
${styleInstruction}
${context.template ? `模板提示：${context.template}` : ""}

源内容：
${trimForPrompt(context.sourceMd, sourceLimit)}

只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释。结构必须如下：
{
  "title": "中文标题",
  "audience": "中文受众",
  "storyline": "中文叙事主线",
  "designSystem": {
    "palette": "中文色彩策略",
    "typography": "中文字体和字号策略",
    "layout": "中文版式系统",
    "visualMotif": "中文视觉母题",
    "rhythm": "中文页面节奏"
  },
  "slides": [
    {
      "index": 1,
      "title": "中文页标题",
      "takeaway": "中文核心结论",
      "layout": "中文版式名称或说明",
      "bullets": ["中文要点 1", "中文要点 2", "中文要点 3"],
      "visual": "中文视觉设计说明",
      "speakerNotes": "中文讲解备注"
    }
  ]
}

硬性要求：
- slides 必须正好 ${targetSlideCount} 页，从 index 1 到 ${targetSlideCount}，不得缺页。
- 所有标题、结论、要点、视觉说明、讲解备注必须是简体中文。
- 只允许 AI、API、LLM、SaaS、PPTX、URL、HTTP 等必要技术缩写保留英文。
- 不要输出 Eight Confirmations、确认门、问题、请回复确认或任何等待用户确认的内容。
- 不要使用 Slide、Page、Thank You、Questions、Generated framework、Clear hierarchy、Source content focus 等英文占位。
- 每页都必须有明确可渲染的版式、可见文字和视觉元素，后续 SVG Executor 不会再读取源内容。
`.trim();

  const strategistMessages: TextMessage[] = [
    {
      role: "system",
      content:
        "你是 PPT Master 的 Strategist。你负责把用户内容规划成可直接渲染的中文幻灯片蓝图。必须输出严格 JSON，所有可见幻灯片文字必须是简体中文。",
    },
    { role: "user", content: userMessage },
  ];

  let content = "";
  try {
    content = await withGenerationRetry(
      () =>
        provider.generateText({
          maxTokens,
          temperature: 0.35,
          timeoutMs: Number(process.env.PPT_AGENT_STRATEGIST_TIMEOUT_MS || 180_000),
          signal: context.signal,
          messages: strategistMessages,
      }),
      context.signal,
      Number(process.env.PPT_AGENT_STRATEGIST_ATTEMPTS || 2),
      (info) =>
        context.onRetry?.(
          `Strategist 第 ${info.attempt} 次请求失败，${Math.round(info.delayMs / 1000)} 秒后重试（${info.nextAttempt}/${info.attempts}）：${summarizeRetryError(info.error)}`
        )
    );
  } catch (error) {
    throw formatStrategistFailure(error);
  }

  throwIfPptCancelled(context.signal);
  try {
    const plan = normalizeStrategistPlan(parseJsonObject(content), targetSlideCount);
    const { designSpec, specLock } = buildStrategistDocuments(plan, context, styleInstruction, targetSlideCount);
    validateStrategistOutput(designSpec, specLock, targetSlideCount);

    mkdirSync(context.projectPath, { recursive: true });
    writeFileSync(join(context.projectPath, "design_spec.md"), designSpec, "utf-8");
    writeFileSync(join(context.projectPath, "spec_lock.md"), specLock, "utf-8");

    return { designSpec, specLock, slideCount: targetSlideCount };
  } catch (error) {
    throw formatStrategistFailure(error);
  }
}

export async function runExecutor(
  context: AgentContext,
  pageIndex: number,
  totalPages: number,
  previousPages: string[] = []
): Promise<ExecutorResult> {
  throwIfPptCancelled(context.signal);
  const provider = context.provider || (await resolvePptTextProvider(context.userId)).provider;
  const executorStyle =
    context.style === "consultant" || context.style === "consultant-top" ? context.style : "general";
  const executorSystemPrompt = [
    loadRolePrompt("executor-base"),
    loadRolePrompt("shared-standards"),
    loadRolePrompt(`executor-${executorStyle}` as "executor-general" | "executor-consultant" | "executor-consultant-top"),
  ].join("\n\n---\n\n");

  const specLockPath = join(context.projectPath, "spec_lock.md");
  if (!existsSync(specLockPath)) {
    throw new Error(`spec_lock.md not found at ${specLockPath}`);
  }
  const specLock = readFileSync(specLockPath, "utf-8");
  const pageSpec = extractPageSpec(specLock, pageIndex);
  const styleInstruction = buildPptStyleInstruction(context);

  const userMessage = `
Project path: ${context.projectPath}
Current slide: ${pageIndex + 1} / ${totalPages}
Canvas: ${context.aspectRatio || "16:9"}
Language: zh-CN. All visible text must be Simplified Chinese.

# Style requirements
${styleInstruction}

# spec_lock.md
${specLock}

# Current slide spec
${pageSpec}

${previousPages.length > 0 ? `Previous slides already generated: ${previousPages.length}. Keep visual consistency with the same colors, typography, spacing, and overall rhythm.` : ""}

Generate only one complete SVG document for this slide.
Requirements:
- If tools are available, read_file spec_lock.md before writing this slide, and use write_file to save the final SVG to svg_output/${String(pageIndex + 1).padStart(2, "0")}_slide.svg. Still return the SVG as final content.
- Return only the SVG code. No Markdown fence.
- Must start with <svg and end with </svg>.
- Use a valid xmlns and viewBox for the canvas.
- 所有可见文字必须是简体中文。不要使用 Slide、Thank You、Questions、Generated framework、Clear hierarchy、Source content focus 等英文占位。
- Keep all text inside the canvas bounds.
- Do not use foreignObject.
`.trim();

  const messages: TextMessage[] = [
    { role: "system", content: executorSystemPrompt },
    { role: "user", content: userMessage },
  ];

  let content: string;
  try {
    content = await withGenerationRetry(
      () =>
        provider.generateText({
          maxTokens: Number(process.env.PPT_AGENT_EXECUTOR_MAX_TOKENS || 7000),
          temperature: 0.3,
          timeoutMs: Number(process.env.PPT_AGENT_EXECUTOR_TIMEOUT_MS || 120_000),
          signal: context.signal,
          messages,
      }),
      context.signal,
      Number(process.env.PPT_AGENT_EXECUTOR_ATTEMPTS || 3),
      (info) =>
        context.onRetry?.(
          `第 ${pageIndex + 1} 页 SVG 第 ${info.attempt} 次生成失败，${Math.round(info.delayMs / 1000)} 秒后重试（${info.nextAttempt}/${info.attempts}）：${summarizeRetryError(info.error)}`
        )
    );
  } catch (error) {
    throw formatExecutorFailure(error, pageIndex);
  }

  throwIfPptCancelled(context.signal);
  const svg = extractSvg(content);
  if (!looksLikeRunnableSvg(svg)) {
    throw new Error(`第 ${pageIndex + 1} 页 SVG 无效：模型返回内容缺少 xmlns/viewBox，或包含 foreignObject。请重试或换用更稳定的 PPT 文本模型。`);
  }
  if (hasBrokenChineseText(svg)) {
    throw new Error(`第 ${pageIndex + 1} 页 SVG 文字疑似乱码。请重试或换用正确支持 UTF-8 中文输出的 PPT 文本模型。`);
  }
  throwIfPptCancelled(context.signal);
  const svgOutputDir = join(context.projectPath, "svg_output");
  mkdirSync(svgOutputDir, { recursive: true });
  writeFileSync(join(svgOutputDir, `${String(pageIndex + 1).padStart(2, "0")}_slide.svg`), svg, "utf-8");

  return { svg, pageIndex };
}

interface StrategistPlan {
  title: string;
  audience: string;
  storyline: string;
  designSystem: {
    palette: string;
    typography: string;
    layout: string;
    visualMotif: string;
    rhythm: string;
  };
  slides: StrategistSlidePlan[];
}

interface StrategistSlidePlan {
  index: number;
  title: string;
  takeaway: string;
  layout: string;
  bullets: string[];
  visual: string;
  speakerNotes: string;
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("模型没有返回有效 JSON 规划。");
  }
}

function normalizeStrategistPlan(value: unknown, targetSlideCount: number): StrategistPlan {
  if (!value || typeof value !== "object") {
    throw new Error("模型返回的规划不是 JSON 对象。");
  }
  const obj = value as Record<string, unknown>;
  const design = typeof obj.designSystem === "object" && obj.designSystem ? (obj.designSystem as Record<string, unknown>) : {};
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : [];
  if (rawSlides.length !== targetSlideCount) {
    throw new Error(`模型返回的页数不正确：需要 ${targetSlideCount} 页，实际 ${rawSlides.length} 页。`);
  }

  const slides = rawSlides.map((item, index) => normalizeSlidePlan(item, index + 1));
  const expectedIndexes = new Set(Array.from({ length: targetSlideCount }, (_, index) => index + 1));
  for (const slide of slides) expectedIndexes.delete(slide.index);
  if (expectedIndexes.size > 0) {
    throw new Error(`模型返回的页码不连续，缺少第 ${Array.from(expectedIndexes).join("、")} 页。`);
  }

  return {
    title: cleanPlanText(obj.title, "未命名 PPT"),
    audience: cleanPlanText(obj.audience, "中文读者"),
    storyline: cleanPlanText(obj.storyline, "围绕主题建立认知、展开分析并给出行动建议。"),
    designSystem: {
      palette: cleanPlanText(design.palette, "清爽高对比配色，重点信息使用强调色。"),
      typography: cleanPlanText(design.typography, "中文无衬线字体，标题醒目，正文保持易读。"),
      layout: cleanPlanText(design.layout, "网格化排版，保留足够留白，突出单页核心结论。"),
      visualMotif: cleanPlanText(design.visualMotif, "使用与主题相关的几何图形、流程节点和信息卡片。"),
      rhythm: cleanPlanText(design.rhythm, "封面、框架、展开、总结逐步推进，页面节奏清晰。"),
    },
    slides,
  };
}

function normalizeSlidePlan(value: unknown, fallbackIndex: number): StrategistSlidePlan {
  if (!value || typeof value !== "object") {
    throw new Error(`第 ${fallbackIndex} 页规划不是 JSON 对象。`);
  }
  const obj = value as Record<string, unknown>;
  const index = Number.isInteger(obj.index) ? Number(obj.index) : fallbackIndex;
  if (index !== fallbackIndex) {
    throw new Error(`第 ${fallbackIndex} 页规划的 index 不正确。`);
  }
  const bullets = Array.isArray(obj.bullets)
    ? obj.bullets.map((item) => cleanPlanText(item, "")).filter(Boolean).slice(0, 5)
    : [];
  if (bullets.length === 0) {
    throw new Error(`第 ${fallbackIndex} 页缺少中文要点。`);
  }
  return {
    index,
    title: cleanPlanText(obj.title, `第 ${fallbackIndex} 页`),
    takeaway: cleanPlanText(obj.takeaway, "本页提炼一个明确结论。"),
    layout: cleanPlanText(obj.layout, "标题加内容区的中文信息布局。"),
    bullets,
    visual: cleanPlanText(obj.visual, "使用清晰的中文信息图和视觉分组。"),
    speakerNotes: cleanPlanText(obj.speakerNotes, "围绕本页结论展开讲解。"),
  };
}

function cleanPlanText(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return fallback;
  return text.slice(0, 500);
}

function buildStrategistDocuments(
  plan: StrategistPlan,
  context: AgentContext,
  styleInstruction: string,
  targetSlideCount: number
) {
  const canvas = context.aspectRatio || "16:9";
  const designSpec = [
    `# ${plan.title}`,
    "",
    "## 项目目标",
    `- 受众：${plan.audience}`,
    `- 叙事主线：${plan.storyline}`,
    `- 画布：${canvas}`,
    `- 目标页数：${targetSlideCount}`,
    "",
    "## 风格要求",
    styleInstruction,
    "",
    "## 设计系统",
    `- 色彩：${plan.designSystem.palette}`,
    `- 字体：${plan.designSystem.typography}`,
    `- 版式：${plan.designSystem.layout}`,
    `- 视觉母题：${plan.designSystem.visualMotif}`,
    `- 页面节奏：${plan.designSystem.rhythm}`,
    "",
    "## 页面规划",
    ...plan.slides.flatMap((slide) => [
      "",
      `### 第 ${slide.index} 页：${slide.title}`,
      `- 核心结论：${slide.takeaway}`,
      `- 版式：${slide.layout}`,
      `- 视觉：${slide.visual}`,
      "- 可见文字：",
      ...slide.bullets.map((item) => `  - ${item}`),
      `- 讲解备注：${slide.speakerNotes}`,
    ]),
    "",
  ].join("\n");

  const specLock = [
    "# spec_lock.md",
    "",
    "## 全局锁定",
    `- 语言：所有可见文字必须是简体中文；仅允许 AI、API、LLM、SaaS、PPTX、URL、HTTP 等必要缩写保留英文。`,
    `- 画布：${canvas}`,
    `- 总页数：${targetSlideCount}`,
    `- 色彩：${plan.designSystem.palette}`,
    `- 字体：${plan.designSystem.typography}`,
    `- 版式系统：${plan.designSystem.layout}`,
    `- 视觉母题：${plan.designSystem.visualMotif}`,
    `- 页面节奏：${plan.designSystem.rhythm}`,
    "",
    "## page_rhythm",
    plan.slides.map((slide) => `- 第 ${slide.index} 页：${slide.title} - ${slide.takeaway}`).join("\n"),
    "",
    "## per-page specs",
    ...plan.slides.flatMap((slide) => [
      "",
      `### 第 ${slide.index} 页：${slide.title}`,
      `- takeaway：${slide.takeaway}`,
      `- layout：${slide.layout}`,
      `- visual：${slide.visual}`,
      "- visible_text：",
      `  - 标题：${slide.title}`,
      `  - 结论：${slide.takeaway}`,
      ...slide.bullets.map((item) => `  - 要点：${item}`),
      `- speaker_notes：${slide.speakerNotes}`,
      "- render_requirements：文字不得越界；不要使用 foreignObject；不要生成英文占位；保持同一套配色、字体和边距。",
    ]),
    "",
  ].join("\n");

  return { designSpec, specLock };
}

function isTransientGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    /TimeoutError|AbortError/i.test(name) ||
    /timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message) ||
    /上游返回\s*(408|409|425|429|500|502|503|504|520|522|524)\b/i.test(message) ||
    /\b(408|409|425|429|500|502|503|504|520|522|524)\b.*(?:request failed|请求失败|bad gateway|gateway|overloaded|rate limit|temporar)/i.test(
      message
    )
  );
}

function isFatalProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /上游返回\s*(401|403)\b|\b(401|403)\b|api key|unauthorized|forbidden|invalid.*key|无权|未授权/i.test(message);
}

function formatStrategistFailure(error: unknown) {
  if (isPptGenerationCancelled(error) || isFatalProviderError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `PPT 规划阶段超时或失败：${message}。系统没有使用本地兜底，请减少页数、换用更稳定的 PPT 文本模型，或稍后重试。`
  );
}

function formatExecutorFailure(error: unknown, pageIndex: number) {
  if (isPptGenerationCancelled(error) || isFatalProviderError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `第 ${pageIndex + 1} 页 SVG 生成超时或失败：${message}。系统没有使用本地兜底，请重试或换用更稳定的 PPT 文本模型。`
  );
}

function trimForPrompt(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated]`;
}

interface GenerationRetryInfo {
  attempt: number;
  nextAttempt: number;
  attempts: number;
  delayMs: number;
  error: unknown;
}

async function withGenerationRetry<T>(
  run: () => Promise<T>,
  signal?: AbortSignal,
  attempts = 3,
  onRetry?: (info: GenerationRetryInfo) => void | Promise<void>
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      throwIfPptCancelled(signal);
      return await run();
    } catch (error) {
      lastError = error;
      throwIfPptCancelled(signal);
      if (attempt >= attempts || !isTransientGenerationError(error)) {
        throw error;
      }
      const delayMs = 1000 * attempt * attempt;
      try {
        await onRetry?.({ attempt, nextAttempt: attempt + 1, attempts, delayMs, error });
      } catch (retryLogError) {
        console.error(retryLogError);
      }
      await sleep(delayMs, signal);
    }
  }
  throw lastError;
}

function summarizeRetryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 220);
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("用户已停止生成"));
    };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function validateStrategistOutput(designSpec: string, specLock: string, targetSlideCount: number) {
  const invalidPatterns = [
    /\[Filled by Strategist\]/i,
    /\{project_name\}/i,
    /^#{0,6}\s*\.{3,}\s*$/m,
    /Eight Confirmations/i,
    /请回复[：:\s]*确认/i,
    /确认[，,]\s*按此生成/i,
    /确认门|Blocking Gate/i,
    /wait for (?:user )?confirmation/i,
    /cannot write|不能写入/i,
  ];
  const normalizedDesign = designSpec.trim();
  const normalizedLock = specLock.trim();
  const hasPlaceholder =
    invalidPatterns.some((pattern) => pattern.test(normalizedDesign) || pattern.test(normalizedLock)) ||
    normalizedDesign.length < 500 ||
    normalizedLock.length < 500;

  const pageMentions = Array.from({ length: targetSlideCount }, (_, index) => index + 1).filter((page) => {
    const padded = String(page).padStart(2, "0");
    const pattern = new RegExp(
      [
        `(?:Slide|Page|第)\\s*0?${page}\\b`,
        `slide[_-]?${padded}\\b`,
        `p0?${page}\\b`,
        `${page}[\\).、]`,
      ].join("|"),
      "i"
    );
    return pattern.test(normalizedLock) || pattern.test(normalizedDesign);
  });

  if (hasPlaceholder || pageMentions.length < Math.min(targetSlideCount, 3)) {
    throw new Error("PPT 规划阶段失败：模型返回了占位内容或不完整规划。请换用更稳定的文本模型，或减少页数后重试。");
  }
}

function clampSlideCount(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(3, Math.min(30, Math.round(value)));
}

function extractPageSpec(specLock: string, pageIndex: number) {
  const slideNo = pageIndex + 1;
  const padded = String(slideNo).padStart(2, "0");
  const patterns = [
    new RegExp(
      `(?:^|\\n)#+\\s*(?:(?:Slide|Page|第)\\s*0?${slideNo}|slide[_-]?${padded}|p0?${slideNo})[^\\n]*\\n([\\s\\S]*?)(?=\\n#+\\s*(?:(?:Slide|Page|第)\\s*\\d+|slide[_-]?\\d+|p\\d+)|$)`,
      "i"
    ),
    new RegExp(`(?:^|\\n)${slideNo}[\\).、]\\s*([^\\n]+(?:\\n(?!\\d+[\\).、]).*)?)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = specLock.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return `Slide ${slideNo}: follow the global design lock and cover the corresponding content from the page plan.`;
}

function extractSvg(text: string) {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) throw new Error("PPT 模型没有返回有效 SVG。请换用更强的文本模型，或减少页数后重试。");
  return match[0];
}

function looksLikeRunnableSvg(svg: string) {
  return (
    /^<svg[\s>]/i.test(svg.trim()) &&
    /\sxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg) &&
    /\sviewBox=["'][^"']+["']/i.test(svg) &&
    !/<foreignObject\b/i.test(svg)
  );
}

function hasBrokenChineseText(svg: string) {
  const text = stripSvgMarkup(svg);
  if (!text.trim()) return true;
  const mojibakeMatches = text.match(/[锛銆绗浣佹湁妯涓鍙鐢诲湪瀛]/g)?.length ?? 0;
  const chineseMatches = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return chineseMatches > 12 && mojibakeMatches / Math.max(chineseMatches, 1) > 0.35;
}

function stripSvgMarkup(svg: string) {
  return svg
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}
