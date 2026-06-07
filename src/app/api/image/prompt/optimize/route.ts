import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseModelList } from "@/lib/model-options";

export const runtime = "nodejs";

const schema = z.object({
  prompt: z.string().trim().min(1, "请输入提示词").max(4000),
  currentPrompt: z.string().trim().max(4000).optional(),
  instruction: z.string().trim().max(1000).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(1000),
      })
    )
    .max(12)
    .optional(),
  mode: z.enum(["generate", "edit"]).default("generate"),
  ratio: z.string().trim().max(20).optional(),
  optimizeMode: z
    .enum(["balanced", "detail", "realistic", "illustration", "product", "concise"])
    .default("balanced"),
});

type OptimizeInput = z.infer<typeof schema>;

interface PromptOptimization {
  prompt: string;
  reply: string;
  explanation: string;
  negativePrompt: string;
  suggestedRatio?: string;
  suggestedQuality: "standard" | "hd" | "ultra";
  suggestedCount: number;
  fallback?: boolean;
}

const MODE_META: Record<
  OptimizeInput["optimizeMode"],
  { label: string; instruction: string; quality: PromptOptimization["suggestedQuality"] }
> = {
  balanced: {
    label: "均衡优化",
    instruction: "在保留原意的基础上补充主体、构图、光线、材质、背景和质量描述。",
    quality: "standard",
  },
  detail: {
    label: "增强细节",
    instruction: "加强细节层次、环境元素、镜头语言、材质和光影，但不要偏离原主题。",
    quality: "hd",
  },
  realistic: {
    label: "真实摄影",
    instruction: "改写为真实摄影风格，强调自然光、真实材质、镜头感和可信场景。",
    quality: "hd",
  },
  illustration: {
    label: "插画风格",
    instruction: "改写为精致插画/角色设计风格，强调画风、色彩、表情和完整构图。",
    quality: "hd",
  },
  product: {
    label: "商品展示",
    instruction: "改写为商业商品图，强调主体展示、干净背景、材质质感、光线和可售卖感。",
    quality: "hd",
  },
  concise: {
    label: "稳定精简",
    instruction: "压缩成更稳定、更直接的生图提示词，去掉重复和冲突表达。",
    quality: "standard",
  },
};

const TEXT_MODEL_HINTS = [
  "gpt-4",
  "gpt-5",
  "gpt-3.5",
  "deepseek",
  "qwen",
  "glm",
  "claude",
  "gemini",
  "moonshot",
  "kimi",
  "yi-",
  "doubao",
  "ernie",
  "hunyuan",
  "chat",
  "turbo",
  "instruct",
];

const ALLOWED_RATIOS = new Set(["1:1", "16:9", "4:3", "3:4", "9:16"]);
const ALLOWED_QUALITIES = new Set(["standard", "hd", "ultra"]);

function pickTextModel(models: string[], fallback: string) {
  const all = Array.from(new Set([...models, fallback].filter(Boolean)));
  return all.find((model) => TEXT_MODEL_HINTS.some((hint) => model.toLowerCase().includes(hint))) || "";
}

async function resolvePromptOptimizerConfig(userId: string) {
  const userCfg = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module: "PROMPT_OPTIMIZER" } },
  });
  if (userCfg?.enabled) {
    const models = parseModelList(userCfg.models);
    const model = pickTextModel(models, userCfg.model) || userCfg.model;
    return {
      baseUrl: userCfg.baseUrl,
      apiKey: decrypt(userCfg.apiKey),
      model,
    };
  }

  const platformCfg = await prisma.providerConfig.findUnique({
    where: { module: "PROMPT_OPTIMIZER" },
  });
  if (platformCfg?.enabled) {
    const models = parseModelList(platformCfg.models);
    const model = pickTextModel(models, platformCfg.model) || platformCfg.model;
    return {
      baseUrl: platformCfg.baseUrl,
      apiKey: decrypt(platformCfg.apiKey),
      model,
    };
  }

  return null;
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function suggestedRatioFor(input: OptimizeInput) {
  if (input.ratio && ALLOWED_RATIOS.has(input.ratio)) return input.ratio;
  if (input.optimizeMode === "product") return "1:1";
  return "1:1";
}

function fallbackOptimizePrompt(input: OptimizeInput): PromptOptimization {
  const prompt = (input.currentPrompt || input.prompt).replace(/\s+/g, " ").trim();
  const meta = MODE_META[input.optimizeMode];
  const userInstruction = input.instruction?.replace(/\s+/g, " ").trim();
  const modeHint =
    input.mode === "edit"
      ? "保留参考图主体结构与核心特征，在此基础上完成修改"
      : "主体清晰明确，构图完整";
  const styleHints: Record<OptimizeInput["optimizeMode"], string[]> = {
    balanced: ["画面干净，主体突出，细节丰富", "自然光影，高质量质感，色彩协调"],
    detail: ["丰富环境细节与层次", "清晰材质纹理，精致光影，画面完成度高"],
    realistic: ["真实摄影质感，自然光线", "真实材质与空间关系，镜头感明确"],
    illustration: ["精致插画风格，角色表情生动", "色彩明快，线条干净，画面完整"],
    product: ["商业产品摄影，干净背景", "主体居中突出，材质清晰，柔和棚拍光"],
    concise: ["主体明确，构图稳定", "清晰，高质量，无多余元素"],
  };
  const ratioHint = `${suggestedRatioFor(input)} 构图`;
  const seen = new Set<string>();
  const details = [prompt, modeHint, ratioHint, ...styleHints[input.optimizeMode], userInstruction]
    .filter((item): item is string => Boolean(item))
    .flatMap((item) => item.split(/[，,]/))
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  const optimized = details.join("，").slice(0, 4000);
  return {
    prompt: optimized,
    reply: userInstruction
      ? `已根据“${userInstruction.slice(0, 80)}”继续调整提示词。`
      : `已按「${meta.label}」生成优化稿。`,
    explanation: `已按「${meta.label}」补充关键画面要素，并尽量保留原意。`,
    negativePrompt: "文字、水印、低清晰度、畸形结构、重复主体、多余肢体、模糊、噪点",
    suggestedRatio: suggestedRatioFor(input),
    suggestedQuality: meta.quality,
    suggestedCount: 1,
    fallback: true,
  };
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
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeOptimization(data: unknown, input: OptimizeInput): PromptOptimization | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const prompt = typeof obj.prompt === "string" ? obj.prompt.trim() : "";
  if (!prompt) return null;
  const rawQuality = typeof obj.suggestedQuality === "string" ? obj.suggestedQuality.trim() : "";
  const suggestedQuality = ALLOWED_QUALITIES.has(rawQuality)
    ? (rawQuality as PromptOptimization["suggestedQuality"])
    : MODE_META[input.optimizeMode].quality;
  const suggestedCount =
    typeof obj.suggestedCount === "number" && Number.isFinite(obj.suggestedCount)
      ? Math.min(10, Math.max(1, Math.floor(obj.suggestedCount)))
      : 1;

  return {
    prompt: prompt.slice(0, 4000),
    reply:
      typeof obj.reply === "string" && obj.reply.trim()
        ? obj.reply.trim().slice(0, 300)
        : typeof obj.explanation === "string" && obj.explanation.trim()
          ? obj.explanation.trim().slice(0, 300)
          : "已根据你的要求更新提示词。",
    explanation:
      typeof obj.explanation === "string" && obj.explanation.trim()
        ? obj.explanation.trim().slice(0, 300)
        : `已按「${MODE_META[input.optimizeMode].label}」优化。`,
    negativePrompt:
      typeof obj.negativePrompt === "string" && obj.negativePrompt.trim()
        ? obj.negativePrompt.trim().slice(0, 500)
        : "文字、水印、低清晰度、畸形结构、重复主体、多余肢体、模糊、噪点",
    suggestedRatio:
      typeof obj.suggestedRatio === "string" && ALLOWED_RATIOS.has(obj.suggestedRatio.trim())
        ? obj.suggestedRatio.trim()
        : suggestedRatioFor(input),
    suggestedQuality,
    suggestedCount,
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  let cfg: Awaited<ReturnType<typeof resolvePromptOptimizerConfig>> = null;
  try {
    cfg = await resolvePromptOptimizerConfig(session.user.id);
  } catch {
    cfg = null;
  }
  if (!cfg) return NextResponse.json(fallbackOptimizePrompt(parsed.data));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${normalizeBaseUrl(cfg.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "你是图片生成提示词优化助手。你必须只输出 JSON 对象，不要 Markdown。字段：prompt, reply, explanation, negativePrompt, suggestedRatio, suggestedQuality, suggestedCount。prompt 必须是中文图片生成提示词，reply 用一句中文说明本轮修改。",
          },
          {
            role: "user",
            content: [
              `模式：${parsed.data.mode === "edit" ? "图生图" : "文生图"}`,
              `比例：${parsed.data.ratio || "未指定"}`,
              `优化方式：${MODE_META[parsed.data.optimizeMode].label}`,
              `优化要求：${MODE_META[parsed.data.optimizeMode].instruction}`,
              `用户本轮要求：${parsed.data.instruction || "按优化方式处理"}`,
              "必须保留用户原意，不要加入水印、文字、商标、NSFW 内容。",
              "如果有当前优化稿，必须基于当前优化稿继续修改，不要从原提示词重新开始。",
              "reply 用一句中文说明你本轮做了什么修改。",
              "suggestedQuality 只能是 standard、hd、ultra；suggestedCount 是 1-10 的整数。",
              `原提示词：${parsed.data.prompt}`,
              parsed.data.currentPrompt ? `当前优化稿：${parsed.data.currentPrompt}` : "",
              parsed.data.messages?.length
                ? `最近对话：${parsed.data.messages
                    .slice(-8)
                    .map((m) => `${m.role === "user" ? "用户" : "助手"}：${m.content}`)
                    .join("\n")}`
                : "",
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return NextResponse.json(fallbackOptimizePrompt(parsed.data));

    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    const optimized = normalizeOptimization(parseJsonObject(text), parsed.data);
    if (!optimized) return NextResponse.json(fallbackOptimizePrompt(parsed.data));
    return NextResponse.json(optimized);
  } catch {
    return NextResponse.json(fallbackOptimizePrompt(parsed.data));
  } finally {
    clearTimeout(timer);
  }
}
