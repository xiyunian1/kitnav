import pptxgen from "pptxgenjs";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { addCredits, consumeCredits, getSettingNumber, InsufficientCreditsError } from "@/lib/credits";
import { IMAGE_QUALITY_META } from "@/lib/image-quality";
import { saveImageFromUrl } from "@/lib/materials";
import { SETTING_KEYS } from "@/lib/settings-config";
import { assertModuleOperationAllowed, OperationBlockedError } from "@/lib/operations";
import {
  ProviderConfigInvalidError,
  ProviderNotConfiguredError,
  resolveBillingMode,
  resolveImageProvider,
  resolveTextProvider,
} from "@/lib/providers";
import { RATIO_TO_PIXEL } from "@/lib/providers/types";
import {
  GORDEN_PPT_TEMPLATES,
  LEGACY_PPT_STRUCTURES,
  PPT_GENERATION_MODES,
  PPT_STYLES,
  PPT_TEMPLATES,
  PPT_TONES,
  type GordenPptTemplate,
  type LegacyPptStructure,
  type PptGenerationMode,
  type PptOutlineSlide,
  type PptSlideContent,
  type PptStyle,
  type PptTemplate,
  type PptTheme,
  type PptTone,
  type SerializedPptProject,
} from "@/lib/ppt-shared";

export { GORDEN_PPT_TEMPLATES, LEGACY_PPT_STRUCTURES, PPT_GENERATION_MODES, PPT_STYLES, PPT_TEMPLATES, PPT_TONES };
export type { GordenPptTemplate, LegacyPptStructure, PptGenerationMode, PptOutlineSlide, PptSlideContent, PptStyle, PptTemplate, PptTheme, PptTone, SerializedPptProject };

const STYLE_THEMES: Record<string, PptTheme> = {
  BUSINESS: {
    primary: "1D4ED8",
    secondary: "0F766E",
    background: "F8FAFC",
    foreground: "0F172A",
    muted: "64748B",
    font: "Microsoft YaHei",
  },
  MINIMAL: {
    primary: "111827",
    secondary: "6B7280",
    background: "FFFFFF",
    foreground: "111827",
    muted: "6B7280",
    font: "Microsoft YaHei",
  },
  TECH: {
    primary: "2563EB",
    secondary: "06B6D4",
    background: "F8FAFC",
    foreground: "0B1220",
    muted: "475569",
    font: "Microsoft YaHei",
  },
  EDUCATION: {
    primary: "047857",
    secondary: "F59E0B",
    background: "F7FEE7",
    foreground: "14532D",
    muted: "4B5563",
    font: "Microsoft YaHei",
  },
  PITCH: {
    primary: "7C3AED",
    secondary: "DB2777",
    background: "FAF5FF",
    foreground: "1F1147",
    muted: "6B7280",
    font: "Microsoft YaHei",
  },
};

const PPT_IMAGE_PARALLEL_LIMIT = 2;
const PPT_META_PREFIX = "__AI_AGGREGATOR_PPT_META__:";

function imageRequestTimeoutMs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 180_000;
  if (seconds === 0) return 0;
  return Math.floor(seconds) * 1000;
}
const PPT_SLIDE_WIDTH = 13.333;
const PPT_SLIDE_HEIGHT = 7.5;

function cssColor(hex: string) {
  return `#${hex.replace(/^#/, "")}`;
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const GORDEN_TEMPLATE_VALUES = new Set(GORDEN_PPT_TEMPLATES.map((item) => item.value));
const LEGACY_STRUCTURE_VALUES = new Set(LEGACY_PPT_STRUCTURES.map((item) => item.value));
const DEFAULT_GORDEN_TEMPLATE = GORDEN_PPT_TEMPLATES[0].value;

function normalizeGenerationMode(value: unknown): PptGenerationMode {
  return value === "TEMPLATE" ? "TEMPLATE" : "FREEFORM";
}

function normalizeLegacyStructure(value: unknown): LegacyPptStructure {
  const v = String(value || "AUTO").toUpperCase();
  return LEGACY_STRUCTURE_VALUES.has(v as LegacyPptStructure) ? (v as LegacyPptStructure) : "AUTO";
}

function normalizeGordenTemplate(value: unknown): GordenPptTemplate {
  const v = String(value || DEFAULT_GORDEN_TEMPLATE);
  return GORDEN_TEMPLATE_VALUES.has(v as GordenPptTemplate) ? (v as GordenPptTemplate) : DEFAULT_GORDEN_TEMPLATE;
}

function normalizeTemplate(value: unknown, mode: PptGenerationMode = "FREEFORM"): PptTemplate {
  return mode === "TEMPLATE" ? normalizeGordenTemplate(value) : normalizeLegacyStructure(value);
}

function getTemplateLabel(template: PptTemplate, mode: PptGenerationMode = "FREEFORM") {
  const items = mode === "TEMPLATE" ? GORDEN_PPT_TEMPLATES : LEGACY_PPT_STRUCTURES;
  return items.find((item) => item.value === template)?.label ?? template;
}

function getGordenTemplate(template: PptTemplate) {
  return GORDEN_PPT_TEMPLATES.find((item) => item.value === template) ?? GORDEN_PPT_TEMPLATES[0];
}

function encodeSourceWithMeta(sourceText: string | undefined, template: PptTemplate, mode: PptGenerationMode) {
  const clean = (sourceText || "").trim();
  if (mode === "FREEFORM" && template === "AUTO") return clean;
  return `${PPT_META_PREFIX}${JSON.stringify({ generationMode: mode, template })}\n${clean}`;
}

function decodeSourceMeta(value: string | null | undefined): {
  sourceText: string;
  generationMode: PptGenerationMode;
  template: PptTemplate;
} {
  const raw = value || "";
  if (!raw.startsWith(PPT_META_PREFIX)) {
    return { sourceText: raw, generationMode: "FREEFORM", template: "AUTO" };
  }
  const lineEnd = raw.indexOf("\n");
  const metaLine = lineEnd >= 0 ? raw.slice(PPT_META_PREFIX.length, lineEnd) : raw.slice(PPT_META_PREFIX.length);
  const sourceText = lineEnd >= 0 ? raw.slice(lineEnd + 1) : "";
  try {
    const parsed = JSON.parse(metaLine) as { generationMode?: unknown; mode?: unknown; template?: unknown };
    const generationMode = normalizeGenerationMode(parsed.generationMode ?? parsed.mode);
    return { sourceText, generationMode, template: normalizeTemplate(parsed.template, generationMode) };
  } catch {
    return { sourceText, generationMode: "FREEFORM", template: "AUTO" };
  }
}

const TEMPLATE_GUIDANCE: Record<LegacyPptStructure, string> = {
  AUTO: "根据主题、受众和资料自动选择最合适的叙事结构。避免模板感，确保每页承担明确的信息任务。",
  CONSULTING:
    "采用咨询汇报结构：先结论后论证，强调问题诊断、关键洞察、证据链、影响评估和行动建议。每页标题尽量写成观点句。",
  PITCH_DECK:
    "采用融资路演结构：痛点、机会、解决方案、产品、市场、商业模式、增长、竞争、团队、融资用途。强调故事线和投资价值。",
  PRODUCT_LAUNCH:
    "采用产品发布结构：场景痛点、核心卖点、功能模块、体验流程、差异优势、客户价值、上线计划。表达要有发布会节奏。",
  TRAINING:
    "采用培训课件结构：学习目标、知识框架、概念解释、案例演示、练习提示、总结回顾。每页要便于教学讲解。",
  RESEARCH:
    "采用研究报告结构：研究背景、方法、关键发现、数据洞察、趋势判断、风险机会、建议。强调严谨、层次和可信度。",
};

const TEMPLATE_VISUAL_GUIDANCE: Record<LegacyPptStructure, string> = {
  AUTO: "按当前内容选择清晰成熟的商业演示视觉。",
  CONSULTING: "咨询报告风格：白底或浅底、细分割线、编号模块、数据卡片、McKinsey/BCG 式克制排版。",
  PITCH_DECK: "路演风格：强封面、深浅对比、产品舞台感、增长曲线、投资叙事，留出大标题区域。",
  PRODUCT_LAUNCH: "产品发布风格：现代科技发布会、产品界面占位、功能卡片、动态光感但不能拥挤。",
  TRAINING: "培训课件风格：清晰网格、步骤卡片、概念图示、柔和配色，适合投影和课堂阅读。",
  RESEARCH: "研究报告风格：数据可视化、图表占位、报告分栏、严谨信息层级，整体克制专业。",
};

function parseJsonFromText(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error("AI 返回格式无法解析");
  }
}

function normalizeSlide(input: unknown, index: number): PptSlideContent {
  const obj = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  const bullets = Array.isArray(obj.bullets)
    ? obj.bullets.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 6)
    : [];
  return {
    order: index + 1,
    title: String(obj.title || `第 ${index + 1} 页`).trim().slice(0, 80),
    subtitle: typeof obj.subtitle === "string" ? obj.subtitle.trim().slice(0, 120) : "",
    layout: normalizeLayout(obj.layout),
    bullets,
    speakerNotes: typeof obj.speakerNotes === "string" ? obj.speakerNotes.trim().slice(0, 1000) : "",
    visualPrompt: typeof obj.visualPrompt === "string" ? obj.visualPrompt.trim().slice(0, 1200) : "",
    accent: typeof obj.accent === "string" ? obj.accent.trim().slice(0, 24) : "",
  };
}

function normalizeOutlineSlide(input: unknown, index: number): PptOutlineSlide {
  const slide = normalizeSlide(input, index);
  return {
    order: index + 1,
    title: slide.title,
    subtitle: slide.subtitle,
    layout: slide.layout,
    bullets: slide.bullets.slice(0, 6),
    speakerNotes: slide.speakerNotes,
    visualPrompt: slide.visualPrompt,
    accent: slide.accent,
  };
}

function normalizeOutlineSlides(input: unknown, slideCount: number, fallbackTopic: string): PptOutlineSlide[] {
  const rawSlides = Array.isArray(input) ? input : [];
  const slides = rawSlides.slice(0, slideCount).map((slide, index) => normalizeOutlineSlide(slide, index));
  while (slides.length < slideCount) {
    slides.push({
      order: slides.length + 1,
      title: `${fallbackTopic} - ${slides.length + 1}`,
      layout: slides.length === 0 ? "COVER" : "CONTENT",
      bullets: ["核心观点", "关键信息", "下一步行动"],
      speakerNotes: "",
      visualPrompt: "",
      accent: "",
    });
  }
  if (slides.length > 0) slides[0].layout = "COVER";
  if (slides.length > 2 && slides[1].layout === "CONTENT") slides[1].layout = "AGENDA";
  if (slides.length > 1 && slides[slides.length - 1].layout === "CONTENT") {
    slides[slides.length - 1].layout = "SUMMARY";
  }
  return slides.map((slide, index) => ({ ...slide, order: index + 1 }));
}

function normalizeLayout(value: unknown): PptSlideContent["layout"] {
  const allowed = new Set(["COVER", "AGENDA", "CONTENT", "SECTION", "COMPARISON", "TIMELINE", "SUMMARY", "THANKS"]);
  const v = String(value || "CONTENT").toUpperCase();
  return allowed.has(v) ? (v as PptSlideContent["layout"]) : "CONTENT";
}

function normalizeGeneratedDeck(data: unknown, fallbackTopic: string, slideCount: number, style: string) {
  const obj = typeof data === "object" && data ? (data as Record<string, unknown>) : {};
  const rawSlides = Array.isArray(obj.slides) ? obj.slides : [];
  const slides = rawSlides.slice(0, slideCount).map((slide, index) => normalizeSlide(slide, index));
  while (slides.length < slideCount) {
    slides.push({
      order: slides.length + 1,
      title: `${fallbackTopic} - ${slides.length + 1}`,
      layout: slides.length === 0 ? "COVER" : "CONTENT",
      bullets: ["核心观点", "关键信息", "下一步行动"],
    });
  }
  slides[0].layout = "COVER";
  if (slides.length > 2 && slides[1].layout === "CONTENT") slides[1].layout = "AGENDA";
  if (slides.length > 1) slides[slides.length - 1].layout = "SUMMARY";

  return {
    title: String(obj.title || fallbackTopic).trim().slice(0, 80),
    theme: { ...STYLE_THEMES[style], ...(typeof obj.theme === "object" && obj.theme ? obj.theme : {}) } as PptTheme,
    slides,
  };
}

type PptVisualContext = {
  title: string;
  topic: string;
  audience: string;
  style: string;
  tone: string;
  generationMode?: PptGenerationMode;
  template?: PptTemplate;
  sourceText?: string;
};

type PptDeckPlanningInput = {
  topic: string;
  audience: string;
  style: PptStyle;
  tone: PptTone;
  generationMode: PptGenerationMode;
  template: PptTemplate;
  slideCount: number;
  sourceText: string;
};

type PptSlideVisualResult = Pick<
  PptSlideContent,
  "imageUrl" | "imagePrompt" | "imageModel" | "imageStatus" | "imageError" | "imageDurationMs"
> & {
  imageStorageKey?: string;
};

function getErrorMessage(error: unknown, fallback = "生成失败") {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

function providerErrorForPptVisual(error: unknown) {
  if (error instanceof ProviderNotConfiguredError) {
    return "图片服务尚未配置，已生成可编辑文字版";
  }
  if (error instanceof ProviderConfigInvalidError) {
    return error.message;
  }
  return getErrorMessage(error, "视觉图生成通道不可用");
}

function buildPptImagePrompt(context: PptVisualContext, theme: PptTheme, slide: PptSlideContent) {
  const styleLabel = PPT_STYLES.find((item) => item.value === context.style)?.label ?? context.style;
  const toneLabel = PPT_TONES.find((item) => item.value === context.tone)?.label ?? context.tone;
  const generationMode = normalizeGenerationMode(context.generationMode);
  const template = normalizeTemplate(context.template, generationMode);
  const legacyTemplate = normalizeLegacyStructure(template);
  const gordenTemplate = getGordenTemplate(template);
  const templateVisualGuidance =
    generationMode === "TEMPLATE"
      ? `GordenPPTSkill 模板「${gordenTemplate.label}」：${gordenTemplate.color}，${gordenTemplate.description}`
      : `${getTemplateLabel(legacyTemplate)}。${TEMPLATE_VISUAL_GUIDANCE[legacyTemplate]}`;
  const layoutGuidance: Record<PptSlideContent["layout"], string> = {
    COVER: "封面：保留左侧或中央大面积干净留白，右侧可以有强视觉焦点、抽象产品场景、空间纵深或精致插画。",
    AGENDA: "目录：生成清晰的分区结构、编号占位、柔和分隔线和图标区域，顶部保留标题区。",
    CONTENT: "内容页：生成现代信息图背景、两列或三块内容容器、图标占位和层次分明的留白。",
    SECTION: "章节页：生成强节奏的章节转场视觉，画面简洁、有冲击力，中央保留标题空间。",
    COMPARISON: "对比页：生成左右分栏、对比关系、平衡构图和清晰的视觉分割。",
    TIMELINE: "时间线：生成横向时间轴、节点、连接线和里程碑占位，画面要有流程感。",
    SUMMARY: "总结页：生成结论卡片、行动建议区和收束感强的背景视觉。",
    THANKS: "结束页：生成简洁高级的收尾画面，保留感谢语或联系方式的留白区域。",
  };
  return [
    "你是一位专家级 UI/UX 演示设计师，专注于生成高质量 PowerPoint 幻灯片背景图。",
    "请生成一张 16:9 横版演示页视觉背景，风格接近商业 Keynote / 高级咨询报告 / 科技发布会幻灯片。",
    "重要：不要渲染任何可读文字、字母、数字、logo、水印、二维码、Markdown 符号；标题和正文会由程序后期叠加。",
    "重要：画面必须给文字层留出干净空间，不能让复杂图形压住主要文字区。",
    `整套主题：${context.topic}`,
    `目标观众：${context.audience || "通用观众"}`,
    `整套风格：${styleLabel}，语气：${toneLabel}`,
    `生成模式：${generationMode === "TEMPLATE" ? "模板生成" : "自由生成"}`,
    `模板策略：${templateVisualGuidance}`,
    `当前页：第 ${slide.order} 页，版式 ${slide.layout}`,
    `页面标题（仅用于理解，不要画成文字）：${slide.title}`,
    slide.subtitle ? `页面副标题（仅用于理解，不要画成文字）：${slide.subtitle}` : "",
    slide.bullets.length ? `要点（仅用于理解，不要画成文字）：${slide.bullets.join("；")}` : "",
    slide.visualPrompt ? `本页视觉建议：${slide.visualPrompt}` : "",
    `版式要求：${layoutGuidance[slide.layout]}`,
    `配色参考：主色 ${cssColor(theme.primary)}，辅色 ${cssColor(theme.secondary)}，背景 ${cssColor(theme.background)}，深色文字 ${cssColor(theme.foreground)}。`,
    "画面质量要求：清晰锐利、构图成熟、层次丰富、光影克制、不要廉价模板感、不要卡通化、不要拥挤。",
    "输出必须是一整张完整幻灯片背景图，边缘不能有裁切提示、边框、浏览器窗口或软件界面。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function generatePptSlideVisual(
  userId: string,
  resolved: Awaited<ReturnType<typeof resolveImageProvider>>,
  context: PptVisualContext,
  theme: PptTheme,
  slide: PptSlideContent,
  timeoutMs: number
): Promise<PptSlideVisualResult> {
  const imagePrompt = buildPptImagePrompt(context, theme, slide);
  const startedAt = Date.now();
  try {
    const out = await resolved.provider.generate({
      prompt: imagePrompt,
      size: RATIO_TO_PIXEL["16:9"],
      quality: IMAGE_QUALITY_META.ultra.providerQuality,
      count: 1,
      timeoutMs,
    });
    const url = out.urls[0];
    if (!url) throw new Error("上游未返回视觉图");
    const stored = await saveImageFromUrl(url, `${userId}-ppt-${slide.order}`);
    return {
      imageUrl: stored.url,
      imageStorageKey: stored.storageKey,
      imagePrompt,
      imageModel: resolved.model,
      imageStatus: "SUCCESS",
      imageError: "",
      imageDurationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      imagePrompt,
      imageModel: resolved.model,
      imageStatus: "FAILED",
      imageError: getErrorMessage(error, "视觉图生成失败").slice(0, 500),
      imageDurationMs: Date.now() - startedAt,
    };
  }
}

async function generatePptSlideVisuals(
  userId: string,
  context: PptVisualContext,
  theme: PptTheme,
  slides: PptSlideContent[]
): Promise<PptSlideVisualResult[]> {
  let resolved: Awaited<ReturnType<typeof resolveImageProvider>>;
  try {
    resolved = await resolveImageProvider(userId, "IMAGE");
  } catch (error) {
    const imageError = providerErrorForPptVisual(error);
    return slides.map((slide) => ({
      imageUrl: "",
      imageStorageKey: "",
      imagePrompt: buildPptImagePrompt(context, theme, slide),
      imageModel: "",
      imageStatus: "FAILED" as const,
      imageError,
      imageDurationMs: null,
    }));
  }

  const results: PptSlideVisualResult[] = Array.from({ length: slides.length });
  const timeoutMs = imageRequestTimeoutMs(
    await getSettingNumber(SETTING_KEYS.IMAGE_REQUEST_TIMEOUT_SECONDS)
  );
  await runWithConcurrency(slides, PPT_IMAGE_PARALLEL_LIMIT, async (slide, index) => {
    results[index] = await generatePptSlideVisual(userId, resolved, context, theme, slide, timeoutMs);
  });
  return results;
}

export function serializePptProject(project: {
  id: string;
  title: string;
  topic: string;
  audience: string | null;
  style: string;
  tone: string;
  slideCount: number;
  sourceText: string | null;
  status: string;
  model: string | null;
  theme: string | null;
  creditsCost: number;
  usedOwnKey: boolean;
  createdAt: Date;
  updatedAt: Date;
  slides: Array<{
    id: string;
    order: number;
    title: string;
    subtitle: string | null;
    layout: string;
    bullets: string | null;
    speakerNotes: string | null;
    visualPrompt: string | null;
    accent: string | null;
    imageUrl: string | null;
    imagePrompt: string | null;
    imageModel: string | null;
    imageStatus: string | null;
    imageError: string | null;
    imageDurationMs: number | null;
  }>;
}): SerializedPptProject {
  const decoded = decodeSourceMeta(project.sourceText);
  return {
    id: project.id,
    title: project.title,
    topic: project.topic,
    audience: project.audience ?? "",
    generationMode: decoded.generationMode,
    style: project.style,
    tone: project.tone,
    template: decoded.template,
    templateLabel: getTemplateLabel(decoded.template, decoded.generationMode),
    slideCount: project.slideCount,
    sourceText: decoded.sourceText,
    status: project.status,
    model: project.model ?? "",
    theme: safeJson(project.theme, STYLE_THEMES[project.style] ?? STYLE_THEMES.BUSINESS),
    creditsCost: project.creditsCost,
    usedOwnKey: project.usedOwnKey,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    slides: project.slides
      .sort((a, b) => a.order - b.order)
      .map((slide) => ({
        id: slide.id,
        order: slide.order,
        title: slide.title,
        subtitle: slide.subtitle ?? "",
        layout: normalizeLayout(slide.layout),
        bullets: safeJson<string[]>(slide.bullets, []),
        speakerNotes: slide.speakerNotes ?? "",
        visualPrompt: slide.visualPrompt ?? "",
        accent: slide.accent ?? "",
        imageUrl: slide.imageUrl ?? "",
        imagePrompt: slide.imagePrompt ?? "",
        imageModel: slide.imageModel ?? "",
        imageStatus: (slide.imageStatus as PptSlideContent["imageStatus"]) ?? "",
        imageError: slide.imageError ?? "",
        imageDurationMs: slide.imageDurationMs ?? null,
      })),
  };
}

export async function getPptBilling(userId: string) {
  const cost = await getSettingNumber(SETTING_KEYS.PPT_CREDIT_COST);
  const billing = await resolveBillingMode(userId, "PPT");
  return { unitCost: cost, ...billing };
}

export async function listPptProjects(userId: string) {
  const projects = await prisma.pptProject.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { slides: { orderBy: { order: "asc" } } },
    take: 20,
  });
  return projects.map(serializePptProject);
}

export async function getPptProject(userId: string, id: string) {
  const project = await prisma.pptProject.findFirst({
    where: { id, userId },
    include: { slides: { orderBy: { order: "asc" } } },
  });
  return project ? serializePptProject(project) : null;
}

export async function generatePptOutline(input: {
  userId: string;
  topic: string;
  audience?: string;
  generationMode?: PptGenerationMode;
  style: PptStyle;
  tone: PptTone;
  template?: PptTemplate;
  slideCount: number;
  sourceText?: string;
  model?: string;
}) {
  const slideCount = Math.min(20, Math.max(3, Math.floor(input.slideCount)));
  const generationMode = normalizeGenerationMode(input.generationMode);
  const template = normalizeTemplate(input.template, generationMode);
  try {
    await assertModuleOperationAllowed(input.userId, "PPT");
  } catch (error) {
    if (error instanceof OperationBlockedError) throw new Error(error.message);
    throw error;
  }

  let resolved;
  try {
    resolved = await resolveTextProvider(input.userId, "PPT", input.model);
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      throw new Error("PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型");
    }
    if (error instanceof ProviderConfigInvalidError) throw error;
    throw error;
  }

  const outline = await generateDeckOutline(resolved.provider, {
    topic: input.topic,
    audience: input.audience || "",
    style: input.style,
    tone: input.tone,
    generationMode,
    template,
    slideCount,
    sourceText: input.sourceText || "",
  });
  return {
    ...outline,
    generationMode,
    template,
    templateLabel: getTemplateLabel(template, generationMode),
    slideCount: outline.slides.length,
    model: resolved.model,
  };
}

export async function generatePptProject(input: {
  userId: string;
  topic: string;
  audience?: string;
  generationMode?: PptGenerationMode;
  style: PptStyle;
  tone: PptTone;
  template?: PptTemplate;
  slideCount: number;
  sourceText?: string;
  model?: string;
  outlineTitle?: string;
  outlineSlides?: PptOutlineSlide[];
}) {
  const slideCount = Math.min(20, Math.max(3, Math.floor(input.slideCount)));
  const generationMode = normalizeGenerationMode(input.generationMode);
  const template = normalizeTemplate(input.template, generationMode);
  try {
    await assertModuleOperationAllowed(input.userId, "PPT");
  } catch (error) {
    if (error instanceof OperationBlockedError) throw new Error(error.message);
    throw error;
  }
  let resolved;
  try {
    resolved = await resolveTextProvider(input.userId, "PPT", input.model);
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      throw new Error("PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型");
    }
    if (error instanceof ProviderConfigInvalidError) throw error;
    throw error;
  }

  const unitCost = await getSettingNumber(SETTING_KEYS.PPT_CREDIT_COST);
  const creditsCost = resolved.useOwnKey ? 0 : unitCost;
  let projectId: string | undefined;
  let consumedCredits = false;
  try {
    if (creditsCost > 0) {
      await consumeCredits(input.userId, creditsCost, `PPT 生成：${input.topic.slice(0, 30)}`);
      consumedCredits = true;
    }

    const project = await prisma.pptProject.create({
      data: {
        userId: input.userId,
        title: input.topic.slice(0, 80),
        topic: input.topic,
        audience: input.audience || "",
        style: input.style,
        tone: input.tone,
        slideCount,
        sourceText: encodeSourceWithMeta(input.sourceText, template, generationMode),
        status: "GENERATING",
        model: resolved.model,
        creditsCost,
        usedOwnKey: resolved.useOwnKey,
      },
      select: { id: true },
    });
    projectId = project.id;

    const deck = input.outlineSlides?.length
      ? await generateDeckFromOutline(resolved.provider, {
          topic: input.topic,
          audience: input.audience || "",
          style: input.style,
          tone: input.tone,
          generationMode,
          template,
          slideCount,
          sourceText: input.sourceText || "",
          outlineTitle: input.outlineTitle,
          outlineSlides: input.outlineSlides,
        })
      : await generateDeckContent(resolved.provider, {
      topic: input.topic,
      audience: input.audience || "",
      style: input.style,
      tone: input.tone,
      generationMode,
      template,
      slideCount,
      sourceText: input.sourceText || "",
        });
    const visuals = await generatePptSlideVisuals(
      input.userId,
      {
        title: deck.title,
        topic: input.topic,
        audience: input.audience || "",
        style: input.style,
        tone: input.tone,
        generationMode,
        template,
        sourceText: input.sourceText || "",
      },
      deck.theme,
      deck.slides
    );
    const visualSuccessCount = visuals.filter((item) => item.imageStatus === "SUCCESS").length;
    const visualFailedCount = Math.max(0, deck.slides.length - visualSuccessCount);

    const generation = await prisma.generation.create({
      data: {
        userId: input.userId,
        module: "PPT",
        prompt: input.topic,
        params: JSON.stringify({
          audience: input.audience,
          style: input.style,
          tone: input.tone,
          slideCount,
          projectId,
          visualMode: "ai-background-with-editable-text",
          generationMode,
          template,
          templateLabel: getTemplateLabel(template, generationMode),
          visualSuccessCount,
          visualFailedCount,
        }),
        status: "SUCCESS",
        resultUrl: projectId,
        creditsCost,
        usedOwnKey: resolved.useOwnKey,
        providerSource: resolved.source,
        providerModel: resolved.model,
        imageCount: slideCount,
        successCount: visualSuccessCount,
        failedCount: visualFailedCount,
      },
      select: { id: true },
    });

    await prisma.$transaction([
      prisma.pptSlide.deleteMany({ where: { projectId } }),
      prisma.pptProject.update({
        where: { id: projectId },
        data: {
          title: deck.title,
          outline: JSON.stringify(deck.slides.map(({ order, title, subtitle, layout }) => ({ order, title, subtitle, layout }))),
          theme: JSON.stringify(deck.theme),
          status: "READY",
          generationId: generation.id,
          slides: {
            create: deck.slides.map((slide, index) => ({
              order: slide.order,
              title: slide.title,
              subtitle: slide.subtitle || "",
              layout: slide.layout,
              bullets: JSON.stringify(slide.bullets),
              speakerNotes: slide.speakerNotes || "",
              visualPrompt: slide.visualPrompt || "",
              accent: slide.accent || "",
              imageUrl: visuals[index]?.imageUrl || null,
              imageStorageKey: visuals[index]?.imageStorageKey || null,
              imagePrompt: visuals[index]?.imagePrompt || null,
              imageModel: visuals[index]?.imageModel || null,
              imageStatus: visuals[index]?.imageStatus || null,
              imageError: visuals[index]?.imageError || null,
              imageDurationMs: visuals[index]?.imageDurationMs ?? null,
            })),
          },
        },
      }),
    ]);

    const full = await getPptProject(input.userId, projectId);
    if (!full) throw new Error("PPT 项目保存失败");
    return full;
  } catch (error) {
    if (consumedCredits) {
      await addCredits(input.userId, creditsCost, "REFUND", `PPT 生成失败退款：${input.topic.slice(0, 30)}`).catch(() => null);
    }
    if (projectId) {
      await prisma.pptProject.update({
        where: { id: projectId },
        data: { status: "FAILED", error: error instanceof Error ? error.message : "生成失败" },
      }).catch(() => null);
    }
    if (error instanceof InsufficientCreditsError) {
      throw new Error(`积分不足，需要 ${error.required}，当前 ${error.balance}`);
    }
    throw error;
  }
}

async function generateDeckContent(
  provider: { generateText: (params: { messages: { role: "system" | "user"; content: string }[]; temperature?: number; maxTokens?: number }) => Promise<string> },
  input: PptDeckPlanningInput
) {
  const styleLabel = PPT_STYLES.find((item) => item.value === input.style)?.label ?? input.style;
  const toneLabel = PPT_TONES.find((item) => item.value === input.tone)?.label ?? input.tone;
  const generationMode = normalizeGenerationMode(input.generationMode);
  const template = normalizeTemplate(input.template, generationMode);
  const legacyTemplate = normalizeLegacyStructure(template);
  const gordenTemplate = getGordenTemplate(template);
  const templatePrompt =
    generationMode === "TEMPLATE"
      ? [
          "生成模式：模板生成。",
          `目标模板：${gordenTemplate.label}`,
          `模板 slug：${gordenTemplate.value}`,
          `模板页数：${gordenTemplate.pages}`,
          `模板主色：${gordenTemplate.color}`,
          `模板适用场景：${gordenTemplate.description}`,
          "请按 GordenPPTSkill 的工作流组织内容：先决定 selected_slides，再为每页写可放入文本槽位的短文本。",
          "输出里的 gordenEdits 只是草案，结构必须是 {template_slug, selected_slides, edits:[{slide, slot_id, new_text}]}。",
          "不要假装已经调用 build_pptx.py；当前只生成可供模板引擎使用的内容计划。",
        ]
      : [
          "生成模式：自由生成。",
          "不使用固定 PPTX 模板，由 AI 自行规划叙事结构、页面角色和视觉风格。",
          `结构策略：${TEMPLATE_GUIDANCE[legacyTemplate]}`,
        ];
  const text = await provider.generateText({
    temperature: 0.35,
    maxTokens: 5000,
    messages: [
      {
        role: "system",
        content:
          "你是资深演示文稿策划师和信息设计师。只输出 JSON，不要 Markdown。生成的 PPT 必须结构完整、可直接用于汇报，并适合导出为可编辑 PPTX。",
      },
      {
        role: "user",
        content: [
          `主题：${input.topic}`,
          `目标观众：${input.audience || "通用观众"}`,
          `页数：${input.slideCount}`,
          `风格：${styleLabel}`,
          `语气：${toneLabel}`,
          ...templatePrompt,
          `参考资料：${input.sourceText || "无"}`,
          "返回 JSON 格式：",
          "{",
          '  "title": "整套 PPT 标题",',
          '  "theme": {"primary":"1D4ED8","secondary":"0F766E","background":"F8FAFC","foreground":"0F172A","muted":"64748B","font":"Microsoft YaHei"},',
          '  "gordenEdits": {"template_slug":"模板模式才需要","selected_slides":[1,2,3],"edits":[{"slide":1,"slot_id":"title","new_text":"短文本"}]},',
          '  "slides": [',
          '    {"title":"页标题","subtitle":"可选副标题","layout":"COVER|AGENDA|CONTENT|SECTION|COMPARISON|TIMELINE|SUMMARY|THANKS","bullets":["3-5 个要点"],"speakerNotes":"演讲备注","visualPrompt":"本页视觉建议","accent":"短标签"}',
          "  ]",
          "}",
          "要求：第一页是封面，第二页通常是目录，最后一页是总结或行动建议。每页要点短句化，不要堆长段落。",
          "要求：根据模板策略安排每页信息角色，页面标题尽量是观点句，而不是泛泛名词。",
        ].join("\n"),
      },
    ],
  });

  return normalizeGeneratedDeck(parseJsonFromText(text), input.topic, input.slideCount, input.style);
}

async function generateDeckOutline(
  provider: { generateText: (params: { messages: { role: "system" | "user"; content: string }[]; temperature?: number; maxTokens?: number }) => Promise<string> },
  input: PptDeckPlanningInput
) {
  const styleLabel = PPT_STYLES.find((item) => item.value === input.style)?.label ?? input.style;
  const toneLabel = PPT_TONES.find((item) => item.value === input.tone)?.label ?? input.tone;
  const generationMode = normalizeGenerationMode(input.generationMode);
  const template = normalizeTemplate(input.template, generationMode);
  const legacyTemplate = normalizeLegacyStructure(template);
  const gordenTemplate = getGordenTemplate(template);
  const strategy =
    generationMode === "TEMPLATE"
      ? `按模板「${gordenTemplate.label}」规划页面角色，模板场景：${gordenTemplate.description}，主色：${gordenTemplate.color}。`
      : TEMPLATE_GUIDANCE[legacyTemplate];

  const text = await provider.generateText({
    temperature: 0.25,
    maxTokens: 3200,
    messages: [
      {
        role: "system",
        content:
          "你是资深演示文稿策划师。只输出 JSON，不要 Markdown。你只负责规划 PPT 大纲，不生成完整正文。",
      },
      {
        role: "user",
        content: [
          `主题：${input.topic}`,
          `目标观众：${input.audience || "通用观众"}`,
          `页数：${input.slideCount}`,
          `风格：${styleLabel}`,
          `语气：${toneLabel}`,
          `结构策略：${strategy}`,
          `参考资料：${input.sourceText || "无"}`,
          "返回 JSON：",
          "{",
          '  "title": "整套 PPT 标题",',
          '  "slides": [',
          '    {"title":"观点句标题","subtitle":"页面任务或过渡说明","layout":"COVER|AGENDA|CONTENT|SECTION|COMPARISON|TIMELINE|SUMMARY|THANKS","bullets":["本页必须覆盖的要点，3-5 条"],"speakerNotes":"讲述重点","visualPrompt":"本页建议的图表/画面/结构","accent":"短标签"}',
          "  ]",
          "}",
          "要求：第一页是封面，第二页通常是目录，最后一页是总结或行动建议。",
          "要求：每页 title 尽量是观点句；bullets 只写本页需要覆盖的信息，不写长段落。",
        ].join("\n"),
      },
    ],
  });

  const obj = parseJsonFromText(text) as Record<string, unknown>;
  const slides = normalizeOutlineSlides(obj.slides, input.slideCount, input.topic);
  return {
    title: String(obj.title || input.topic).trim().slice(0, 80),
    slides,
  };
}

async function generateDeckFromOutline(
  provider: { generateText: (params: { messages: { role: "system" | "user"; content: string }[]; temperature?: number; maxTokens?: number }) => Promise<string> },
  input: PptDeckPlanningInput & { outlineTitle?: string; outlineSlides: PptOutlineSlide[] }
) {
  const outlineSlides = normalizeOutlineSlides(input.outlineSlides, input.slideCount, input.topic);
  const outlineTitle = input.outlineTitle?.trim().slice(0, 80);
  const text = await provider.generateText({
    temperature: 0.35,
    maxTokens: 5000,
    messages: [
      {
        role: "system",
        content:
          "你是资深演示文稿策划师和信息设计师。只输出 JSON，不要 Markdown。请严格保留用户确认的大纲顺序和页面角色，补全可直接用于 PPT 的正文与备注。",
      },
      {
        role: "user",
        content: [
          `主题：${input.topic}`,
          `目标观众：${input.audience || "通用观众"}`,
          `风格：${PPT_STYLES.find((item) => item.value === input.style)?.label ?? input.style}`,
          `语气：${PPT_TONES.find((item) => item.value === input.tone)?.label ?? input.tone}`,
          `确认后的整套标题：${outlineTitle || input.topic}`,
          `参考资料：${input.sourceText || "无"}`,
          "用户已确认的大纲：",
          JSON.stringify(outlineSlides),
          "返回 JSON 格式：",
          "{",
          '  "title": "整套 PPT 标题",',
          '  "theme": {"primary":"1D4ED8","secondary":"0F766E","background":"F8FAFC","foreground":"0F172A","muted":"64748B","font":"Microsoft YaHei"},',
          '  "slides": [',
          '    {"title":"保留或优化后的页标题","subtitle":"可选副标题","layout":"COVER|AGENDA|CONTENT|SECTION|COMPARISON|TIMELINE|SUMMARY|THANKS","bullets":["3-5 个短要点"],"speakerNotes":"演讲备注","visualPrompt":"本页视觉建议","accent":"短标签"}',
          "  ]",
          "}",
          "要求：slides 数量、顺序、layout 应与用户确认的大纲一致；可优化措辞，但不能改变叙事结构。",
          "要求：每页要点短句化，信息密度适合投影阅读。",
        ].join("\n"),
      },
    ],
  });

  const deck = normalizeGeneratedDeck(parseJsonFromText(text), input.topic, outlineSlides.length, input.style);
  return {
    ...deck,
    title: outlineTitle || deck.title,
    slides: deck.slides.map((slide, index) => {
      const outline = outlineSlides[index];
      if (!outline) return { ...slide, order: index + 1 };
      return {
        ...slide,
        order: index + 1,
        layout: outline.layout,
        title: slide.title || outline.title,
        subtitle: slide.subtitle || outline.subtitle,
        visualPrompt: slide.visualPrompt || outline.visualPrompt,
        accent: slide.accent || outline.accent,
      };
    }),
  };
}

export async function updatePptSlide(
  userId: string,
  slideId: string,
  input: Partial<Pick<PptSlideContent, "title" | "subtitle" | "layout" | "bullets" | "speakerNotes" | "visualPrompt" | "accent">>
) {
  const slide = await prisma.pptSlide.findFirst({
    where: { id: slideId, project: { userId } },
    include: { project: true },
  });
  if (!slide) throw new Error("幻灯片不存在");
  await prisma.pptSlide.update({
    where: { id: slideId },
    data: {
      title: input.title?.slice(0, 100) ?? slide.title,
      subtitle: input.subtitle?.slice(0, 160) ?? slide.subtitle,
      layout: input.layout ? normalizeLayout(input.layout) : slide.layout,
      bullets: input.bullets ? JSON.stringify(input.bullets.slice(0, 8)) : slide.bullets,
      speakerNotes: input.speakerNotes?.slice(0, 1500) ?? slide.speakerNotes,
      visualPrompt: input.visualPrompt?.slice(0, 700) ?? slide.visualPrompt,
      accent: input.accent?.slice(0, 24) ?? slide.accent,
      project: { update: { updatedAt: new Date() } },
    },
  });
  return getPptProject(userId, slide.projectId);
}

export async function regeneratePptSlideVisual(userId: string, slideId: string) {
  const slide = await prisma.pptSlide.findFirst({
    where: { id: slideId, project: { userId } },
    include: { project: true },
  });
  if (!slide) throw new Error("幻灯片不存在");

  const theme = safeJson(slide.project.theme, STYLE_THEMES[slide.project.style] ?? STYLE_THEMES.BUSINESS);
  const decoded = decodeSourceMeta(slide.project.sourceText);
  const content: PptSlideContent = {
    id: slide.id,
    order: slide.order,
    title: slide.title,
    subtitle: slide.subtitle ?? "",
    layout: normalizeLayout(slide.layout),
    bullets: safeJson<string[]>(slide.bullets, []),
    speakerNotes: slide.speakerNotes ?? "",
    visualPrompt: slide.visualPrompt ?? "",
    accent: slide.accent ?? "",
  };

  let result: PptSlideVisualResult;
  try {
    const resolved = await resolveImageProvider(userId, "IMAGE");
    const timeoutMs = imageRequestTimeoutMs(
      await getSettingNumber(SETTING_KEYS.IMAGE_REQUEST_TIMEOUT_SECONDS)
    );
    result = await generatePptSlideVisual(
      userId,
      resolved,
      {
        title: slide.project.title,
        topic: slide.project.topic,
        audience: slide.project.audience ?? "",
        style: slide.project.style,
        tone: slide.project.tone,
        generationMode: decoded.generationMode,
        template: decoded.template,
        sourceText: slide.project.sourceText ?? "",
      },
      theme,
      content,
      timeoutMs
    );
  } catch (error) {
    result = {
      imagePrompt: buildPptImagePrompt(
        {
          title: slide.project.title,
          topic: slide.project.topic,
          audience: slide.project.audience ?? "",
          style: slide.project.style,
          tone: slide.project.tone,
          generationMode: decoded.generationMode,
          template: decoded.template,
          sourceText: slide.project.sourceText ?? "",
        },
        theme,
        content
      ),
      imageStatus: "FAILED",
      imageError: providerErrorForPptVisual(error),
      imageDurationMs: null,
    };
  }

  await prisma.pptSlide.update({
    where: { id: slideId },
    data: {
      imageUrl: result.imageUrl || null,
      imageStorageKey: result.imageStorageKey || null,
      imagePrompt: result.imagePrompt || null,
      imageModel: result.imageModel || null,
      imageStatus: result.imageStatus || null,
      imageError: result.imageError || null,
      imageDurationMs: result.imageDurationMs ?? null,
      project: { update: { updatedAt: new Date() } },
    },
  });
  return getPptProject(userId, slide.projectId);
}

export async function rewritePptSlide(userId: string, slideId: string, instruction: string, model?: string) {
  const slide = await prisma.pptSlide.findFirst({
    where: { id: slideId, project: { userId } },
    include: { project: { include: { slides: { orderBy: { order: "asc" } } } } },
  });
  if (!slide) throw new Error("幻灯片不存在");
  const resolved = await resolveTextProvider(userId, "PPT", model);
  const current = serializePptProject(slide.project);
  const text = await resolved.provider.generateText({
    temperature: 0.35,
    maxTokens: 1800,
    messages: [
      { role: "system", content: "你是 PPT 单页改写助手。只输出 JSON，不要 Markdown。" },
      {
        role: "user",
        content: [
          `整套主题：${current.topic}`,
          `当前页：${JSON.stringify(current.slides.find((item) => item.id === slideId))}`,
          `修改要求：${instruction}`,
          "除非修改要求明确提到更换版式，否则 layout 必须保持当前页原版式。",
          '返回 JSON：{"title":"","subtitle":"","layout":"CONTENT","bullets":[""],"speakerNotes":"","visualPrompt":"","accent":""}',
        ].join("\n"),
      },
    ],
  });
  const next = normalizeSlide(parseJsonFromText(text), slide.order - 1);
  if (!/版式|布局|layout/i.test(instruction)) {
    next.layout = normalizeLayout(slide.layout);
  }
  return updatePptSlide(userId, slideId, next);
}

export async function exportPptx(userId: string, projectId: string) {
  const project = await getPptProject(userId, projectId);
  if (!project) throw new Error("PPT 项目不存在");
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "AI Aggregator";
  pptx.subject = project.topic;
  pptx.title = project.title;
  pptx.company = "AI Aggregator";
  pptx.theme = {
    headFontFace: project.theme.font,
    bodyFontFace: project.theme.font,
  };

  for (const slideContent of project.slides) {
    addSlide(pptx, project.theme, slideContent, project.title, project.template);
  }

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
}

function resolvePublicImagePath(url?: string) {
  if (!url || !url.startsWith("/")) return null;
  const relativePath = url.replace(/^\/+/, "").replace(/\?.*$/, "");
  if (!relativePath.startsWith("uploads/")) return null;
  const imagePath = path.join(process.cwd(), "public", relativePath);
  return existsSync(imagePath) ? imagePath : null;
}

function getPngDimensions(imagePath: string) {
  try {
    const buffer = readFileSync(imagePath);
    if (buffer.length < 24) return null;
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!isPng) return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
  }
}

function getContainedImageBox(imagePath: string) {
  const size = getPngDimensions(imagePath);
  if (!size || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, w: PPT_SLIDE_WIDTH, h: PPT_SLIDE_HEIGHT };
  }

  const imageRatio = size.width / size.height;
  const slideRatio = PPT_SLIDE_WIDTH / PPT_SLIDE_HEIGHT;
  if (imageRatio > slideRatio) {
    const h = PPT_SLIDE_WIDTH / imageRatio;
    return { x: 0, y: (PPT_SLIDE_HEIGHT - h) / 2, w: PPT_SLIDE_WIDTH, h };
  }

  const w = PPT_SLIDE_HEIGHT * imageRatio;
  return { x: (PPT_SLIDE_WIDTH - w) / 2, y: 0, w, h: PPT_SLIDE_HEIGHT };
}

function addVisualTextLayer(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  theme: PptTheme,
  content: PptSlideContent,
  deckTitle: string,
  template: PptTemplate
) {
  const foreground = theme.foreground;
  const muted = theme.muted;
  const primary = theme.primary;
  const translucentWhite = { color: "FFFFFF", transparency: 8 };

  if (content.layout === "COVER" || template === "PITCH_DECK") {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.72,
      y: 0.78,
      w: 7.15,
      h: 5.85,
      rectRadius: 0.16,
      fill: { color: "FFFFFF", transparency: 7 },
      line: { color: "FFFFFF", transparency: 100 },
    });
    slide.addText(deckTitle, {
      x: 1.0,
      y: 1.22,
      w: 6.3,
      h: 0.28,
      fontFace: theme.font,
      fontSize: 9,
      color: muted,
      bold: true,
      margin: 0,
      fit: "shrink",
    });
    slide.addText(content.title, {
      x: 0.98,
      y: 1.78,
      w: 6.45,
      h: 1.55,
      fontFace: theme.font,
      fontSize: 31,
      color: foreground,
      bold: true,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: 1.02,
        y: 3.45,
        w: 5.8,
        h: 0.55,
        fontFace: theme.font,
        fontSize: 13,
        color: muted,
        margin: 0,
        fit: "shrink",
      });
    }
    if (content.bullets.length > 0) {
      slide.addText(content.bullets.slice(0, 3).join("  /  "), {
        x: 1.02,
        y: 5.55,
        w: 5.9,
        h: 0.32,
        fontFace: theme.font,
        fontSize: 10,
        color: primary,
        bold: true,
        margin: 0,
        fit: "shrink",
      });
    }
    if (content.speakerNotes) slide.addNotes(content.speakerNotes);
    return;
  }

  if (template === "CONSULTING" || template === "RESEARCH") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.58,
      y: 0.48,
      w: 11.95,
      h: 6.35,
      fill: { color: "FFFFFF", transparency: 10 },
      line: { color: "CBD5E1", transparency: 35 },
    });
  } else {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.55,
      y: 0.42,
      w: 12.2,
      h: 6.55,
      rectRadius: 0.1,
      fill: { color: "FFFFFF", transparency: 18 },
      line: { color: "FFFFFF", transparency: 100 },
    });
  }
  slide.addText(String(content.order).padStart(2, "0"), {
    x: 0.82,
    y: 0.72,
    w: 0.58,
    h: 0.24,
    fontFace: theme.font,
    fontSize: 9,
    color: primary,
    bold: true,
    margin: 0,
  });
  slide.addText(content.title, {
    x: 1.48,
    y: 0.62,
    w: 9.8,
    h: 0.44,
    fontFace: theme.font,
    fontSize: 21,
    color: foreground,
    bold: true,
    margin: 0,
    fit: "shrink",
  });
  if (content.subtitle) {
    slide.addText(content.subtitle, {
      x: 1.5,
      y: 1.08,
      w: 8.8,
      h: 0.28,
      fontFace: theme.font,
      fontSize: 9.5,
      color: muted,
      margin: 0,
      fit: "shrink",
    });
  }

  const bullets = content.bullets.slice(0, template === "TRAINING" ? 7 : 6);
  const columns = bullets.length > 3 ? 2 : 1;
  bullets.forEach((item, index) => {
    const col = columns === 2 ? index % 2 : 0;
    const row = columns === 2 ? Math.floor(index / 2) : index;
    const x = columns === 2 ? 0.9 + col * 5.9 : 1.18;
    const y = 1.72 + row * 1.02;
    const w = columns === 2 ? 5.35 : 10.55;
    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w,
      h: 0.72,
      rectRadius: 0.08,
      fill: translucentWhite,
      line: { color: "FFFFFF", transparency: 58 },
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x + 0.22,
      y: y + 0.2,
      w: 0.42,
      h: 0.18,
      fontFace: theme.font,
      fontSize: 8,
      color: primary,
      bold: true,
      margin: 0,
    });
    slide.addText(item, {
      x: x + 0.72,
      y: y + 0.15,
      w: w - 0.95,
      h: 0.34,
      fontFace: theme.font,
      fontSize: 11.8,
      color: foreground,
      margin: 0,
      fit: "shrink",
    });
  });

  if (content.speakerNotes) slide.addNotes(content.speakerNotes);
}

function addTemplateBackground(pptx: pptxgen, slide: pptxgen.Slide, theme: PptTheme, template: PptTemplate) {
  if (template === "PITCH_DECK" || template === "PRODUCT_LAUNCH") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: PPT_SLIDE_WIDTH,
      h: PPT_SLIDE_HEIGHT,
      fill: { color: theme.background },
      line: { color: theme.background },
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 8.7,
      y: -0.9,
      w: 5.7,
      h: 5.7,
      fill: { color: theme.primary, transparency: 18 },
      line: { color: theme.primary, transparency: 100 },
      rotate: 15,
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 9.7,
      y: 3.8,
      w: 4.6,
      h: 4.6,
      fill: { color: theme.secondary, transparency: 22 },
      line: { color: theme.secondary, transparency: 100 },
      rotate: 210,
    });
    return;
  }

  if (template === "CONSULTING" || template === "RESEARCH") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: PPT_SLIDE_WIDTH,
      h: PPT_SLIDE_HEIGHT,
      fill: { color: theme.background },
      line: { color: theme.background },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.18,
      h: PPT_SLIDE_HEIGHT,
      fill: { color: theme.primary },
      line: { color: theme.primary },
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.6,
      y: 1.28,
      w: 11.7,
      h: 0,
      line: { color: "CBD5E1", transparency: 25, width: 1 },
    });
    return;
  }

  if (template === "TRAINING") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: PPT_SLIDE_WIDTH,
      h: PPT_SLIDE_HEIGHT,
      fill: { color: theme.background },
      line: { color: theme.background },
    });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.55,
      y: 0.45,
      w: 12.25,
      h: 6.5,
      rectRadius: 0.12,
      fill: { color: "FFFFFF", transparency: 0 },
      line: { color: "DCFCE7", transparency: 15 },
    });
    return;
  }

  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.16,
    h: PPT_SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { color: theme.primary },
  });
}

function addSlide(pptx: pptxgen, theme: PptTheme, content: PptSlideContent, deckTitle: string, template: PptTemplate) {
  const slide = pptx.addSlide();
  slide.background = { color: theme.background };

  const imagePath = resolvePublicImagePath(content.imageUrl);
  if (imagePath) {
    const imageBox = getContainedImageBox(imagePath);
    slide.addImage({
      path: imagePath,
      ...imageBox,
    });
    addVisualTextLayer(pptx, slide, theme, content, deckTitle, template);
    return;
  }

  addTemplateBackground(pptx, slide, theme, template);

  const footer = `${content.order.toString().padStart(2, "0")} / ${deckTitle}`;
  slide.addText(footer, {
    x: 0.45,
    y: 7.05,
    w: 12,
    h: 0.25,
    fontFace: theme.font,
    fontSize: 7,
    color: theme.muted,
    margin: 0,
    breakLine: false,
  });

  if (content.layout === "COVER") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6,
      y: 0.65,
      w: 1.2,
      h: 0.08,
      fill: { color: theme.secondary },
      line: { color: theme.secondary },
    });
    slide.addText(content.title, {
      x: template === "PITCH_DECK" ? 0.86 : 0.65,
      y: template === "PITCH_DECK" ? 1.38 : 1.55,
      w: template === "PITCH_DECK" ? 7.8 : 11.4,
      h: 1.2,
      fontFace: theme.font,
      fontSize: template === "PITCH_DECK" ? 38 : 34,
      bold: true,
      color: theme.foreground,
      margin: 0,
      fit: "shrink",
    });
    if (content.subtitle) {
      slide.addText(content.subtitle, {
        x: template === "PITCH_DECK" ? 0.9 : 0.7,
        y: template === "PITCH_DECK" ? 2.88 : 2.85,
        w: template === "PITCH_DECK" ? 7.0 : 9.8,
        h: 0.55,
        fontFace: theme.font,
        fontSize: 16,
        color: theme.muted,
        margin: 0,
        fit: "shrink",
      });
    }
    slide.addText(content.bullets.slice(0, 3).join(" · "), {
      x: template === "PITCH_DECK" ? 0.9 : 0.7,
      y: 5.4,
      w: template === "PITCH_DECK" ? 7.6 : 10.8,
      h: 0.45,
      fontFace: theme.font,
      fontSize: 13,
      color: theme.primary,
      bold: true,
      margin: 0,
      fit: "shrink",
    });
    if (content.speakerNotes) {
      slide.addNotes(content.speakerNotes);
    }
    return;
  }

  const titleX = template === "CONSULTING" || template === "RESEARCH" ? 0.72 : 0.62;
  slide.addText(content.title, {
    x: titleX,
    y: 0.42,
    w: template === "PRODUCT_LAUNCH" ? 8.6 : 11.7,
    h: 0.5,
    fontFace: theme.font,
    fontSize: template === "TRAINING" ? 24 : 22,
    bold: true,
    color: theme.foreground,
    margin: 0,
    fit: "shrink",
  });
  if (content.subtitle) {
    slide.addText(content.subtitle, {
      x: titleX + 0.03,
      y: 0.96,
      w: 10.8,
      h: 0.3,
      fontFace: theme.font,
      fontSize: 10,
      color: theme.muted,
      margin: 0,
      fit: "shrink",
    });
  }

  if (content.layout === "AGENDA" || content.layout === "SUMMARY" || template === "TRAINING") {
    content.bullets.slice(0, 7).forEach((item, index) => {
      slide.addText(String(index + 1).padStart(2, "0"), {
        x: 0.82,
        y: 1.65 + index * 0.7,
        w: 0.5,
        h: 0.32,
        fontFace: theme.font,
        fontSize: 11,
        bold: true,
        color: theme.primary,
        margin: 0,
      });
      slide.addText(item, {
        x: 1.45,
        y: 1.58 + index * 0.7,
        w: 9.8,
        h: 0.42,
        fontFace: theme.font,
        fontSize: 15,
        color: theme.foreground,
        margin: 0,
        fit: "shrink",
      });
    });
    return;
  }

  const bullets = content.bullets.length ? content.bullets : ["核心观点", "关键证据", "下一步行动"];
  const left = bullets.slice(0, Math.ceil(bullets.length / 2));
  const right = bullets.slice(Math.ceil(bullets.length / 2));
  const columns = right.length ? [left, right] : [left];
  columns.forEach((items, columnIndex) => {
    items.forEach((item, index) => {
      const x = columns.length === 2 ? 0.8 + columnIndex * 5.75 : 1.0;
      const y = 1.75 + index * 0.9;
      slide.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: columns.length === 2 ? 5.0 : 10.7,
        h: 0.62,
        rectRadius: 0.08,
        fill: { color: "FFFFFF", transparency: 5 },
        line: { color: "E2E8F0" },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: x + 0.22,
        y: y + 0.2,
        w: 0.18,
        h: 0.18,
        fill: { color: theme.secondary },
        line: { color: theme.secondary },
      });
      slide.addText(item, {
        x: x + 0.55,
        y: y + 0.13,
        w: columns.length === 2 ? 4.1 : 9.7,
        h: 0.35,
        fontFace: theme.font,
        fontSize: 12.5,
        color: theme.foreground,
        margin: 0,
        fit: "shrink",
      });
    });
  });

  if (content.speakerNotes) {
    slide.addNotes(content.speakerNotes);
  }
}
