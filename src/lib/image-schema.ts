import { z } from "zod";
import { ASPECT_RATIOS, MAX_IMAGE_COUNT } from "@/lib/providers/types";
import { IMAGE_QUALITIES } from "@/lib/image-quality";

// 图片工作台相关请求的共享校验。

// 文生图：JSON 请求
export const generateTurnSchema = z.object({
  conversationId: z.string().trim().min(1).optional(), // 不传则新建会话
  prompt: z.string().trim().min(1, "请输入提示词").max(4000),
  ratio: z.enum(ASPECT_RATIOS).default("1:1"),
  quality: z.enum(IMAGE_QUALITIES).default("standard"),
  count: z.number().int().min(1).max(MAX_IMAGE_COUNT).default(1),
  model: z.string().trim().min(1).max(100).optional(),
});
export type GenerateTurnInput = z.infer<typeof generateTurnSchema>;

// 图生图：multipart，文本字段在 route 内手动取出后用此校验（count 为字符串转数字）
export const editTurnFieldsSchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1, "请输入提示词").max(4000),
  ratio: z.enum(ASPECT_RATIOS).default("1:1"),
  quality: z.enum(IMAGE_QUALITIES).default("standard"),
  count: z.coerce.number().int().min(1).max(MAX_IMAGE_COUNT).default(1),
  model: z.string().trim().min(1).max(100).optional(),
});

// 会话重命名
export const renameConversationSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(60),
});
