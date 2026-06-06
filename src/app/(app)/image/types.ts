// 前端工作台类型（与后端 SerializedTurn 对齐，但不 import 服务端模块）

export type TurnImageStatus = "queued" | "loading" | "success" | "error";
export type TurnStatus = "PENDING" | "SUCCESS" | "FAILED";

export interface TurnImage {
  id: string;
  status: TurnImageStatus;
  url?: string;
  error?: string;
  upstreamStatus?: number;
}

export interface Turn {
  id: string;
  conversationId: string;
  prompt: string;
  mode: "generate" | "edit";
  model: string;
  ratio: string;
  count: number;
  status: TurnStatus;
  images: TurnImage[];
  referenceThumbs: string[];
  error: string | null;
  creditsCost: number;
  usedOwnKey: boolean;
  generationId?: string | null;
  createdAt: string;
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
