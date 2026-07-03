import { z } from "zod";
import { PPT_THINKING_LEVELS } from "@/lib/ppt-agent/model-options";

// API 配置的共享校验 schema，用户接口和后台 Action 复用。
// apiKey 可选：留空表示「不修改现有 key」（编辑场景，避免要求重填）。

export const MODULE_TYPES = ["IMAGE", "VIDEO", "PROMPT_OPTIMIZER", "PPT"] as const;
export type ConfigModule = (typeof MODULE_TYPES)[number];

export const API_CONFIG_MODULES: Array<{
  key: string;
  moduleType: ConfigModule;
  name: string;
  description: string;
  active: boolean;
  modelKind: "image" | "text";
}> = [
  {
    key: "image",
    moduleType: "IMAGE",
    name: "图片生成",
    description: "文生图、图生图等图片模型配置",
    active: true,
    modelKind: "image",
  },
  {
    key: "prompt-optimizer",
    moduleType: "PROMPT_OPTIMIZER",
    name: "提示词优化",
    description: "AI 提示词助手使用的文本模型配置",
    active: true,
    modelKind: "text",
  },
  {
    key: "ppt",
    moduleType: "PPT",
    name: "PPT 生成",
    description: "Claude API 配置，用于 PPT 生成的 multi-agent 协作",
    active: true,
    modelKind: "text",
  },
  {
    key: "video",
    moduleType: "VIDEO",
    name: "视频生成",
    description: "视频模型配置，模块即将上线",
    active: false,
    modelKind: "image",
  },
];

export const apiConfigSchema = z.object({
  module: z.enum(MODULE_TYPES),
  baseUrl: z
    .string()
    .trim()
    .url("Base URL 格式不正确")
    .max(300),
  apiKey: z.string().trim().max(300).optional(),
  model: z.string().trim().min(1, "请填写模型名").max(100),
  models: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  modelMeta: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        creditCost: z.number().int().min(0).optional(),
        note: z.string().trim().max(100).optional(),
      })
    )
    .optional(),
  modelOptions: z
    .object({
      thinkingLevel: z.enum(PPT_THINKING_LEVELS).optional(),
    })
    .optional(),
  enabled: z.boolean().default(false),
});

export type ApiConfigInput = z.infer<typeof apiConfigSchema>;

// 测试连接的校验（apiKey 必填，因为要真实调用；但允许用已存的 key 占位符）
export const testConnectionSchema = z.object({
  module: z.enum(MODULE_TYPES),
  baseUrl: z.string().trim().url("Base URL 格式不正确"),
  apiKey: z.string().trim().optional(),
  model: z.string().trim().min(1, "请填写模型名"),
});

// 拉取模型列表的校验（只需 baseUrl；apiKey 留空用已存的 key）
export const listModelsSchema = z.object({
  module: z.enum(MODULE_TYPES),
  baseUrl: z.string().trim().url("Base URL 格式不正确"),
  apiKey: z.string().trim().optional(),
});
