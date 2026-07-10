// 前端工作台类型（与后端 SerializedTurn 对齐，但不 import 服务端模块）
import type { ModelSource } from "@/lib/module-model-options";

export type TurnImageStatus = "queued" | "loading" | "success" | "error";
export type TurnStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface TurnImage {
  id: string;
  status: TurnImageStatus;
  url?: string;
  error?: string;
  upstreamStatus?: number;
  durationMs?: number;
  quality?: string;
}

export interface Turn {
  id: string;
  conversationId: string;
  prompt: string;
  mode: "generate" | "edit";
  model: string;
  providerSource: ModelSource | null;
  ratio: string;
  count: number;
  status: TurnStatus;
  images: TurnImage[];
  referenceThumbs: string[];
  error: string | null;
  creditsCost: number;
  usedOwnKey: boolean;
  durationMs?: number | null;
  generationId?: string | null;
  createdAt: string;
}

export interface ReuseTurnInput {
  prompt: string;
  mode: "generate" | "edit";
  ratio: string;
  quality?: string;
  count?: number;
  model?: string;
  modelSource?: ModelSource;
}

export type PromptOptimizeMode =
  | "balanced"
  | "detail"
  | "realistic"
  | "illustration"
  | "product"
  | "concise";

export interface PromptOptimizationResult {
  prompt: string;
  reply?: string;
  explanation?: string;
  negativePrompt?: string;
  suggestedRatio?: string;
  suggestedQuality?: string;
  suggestedCount?: number;
  fallback?: boolean;
}

export interface PromptOptimizeRequest {
  optimizeMode: PromptOptimizeMode;
  instruction?: string;
  currentPrompt?: string;
  messages?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  totalTurns: number;
  hasMore: boolean;
  nextBefore: string | null;
}
