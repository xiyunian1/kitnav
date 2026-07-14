import type { ConversationSummary, ConversationDetail, Turn } from "./types";
import type { ModelSource } from "@/lib/module-model-options";

export type TurnStreamEvent =
  | { type: "created"; turn: Turn; conversationId: string }
  | { type: "image"; turnId: string; image: Turn["images"][number] }
  | { type: "final"; turn: Turn; conversationId: string }
  | { type: "error"; status?: number; error: string };

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    return fallback;
  }
}

export interface ConversationListPage {
  conversations: ConversationSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ConversationSnapshot {
  conversation: ConversationDetail;
  balance: number;
}

export interface CancelTurnResult {
  turn: Turn;
  balance: number;
}

function readBalance(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("积分余额响应无效");
  }
  return value;
}

export async function listConversations(
  q = "",
  cursor?: string,
): Promise<ConversationListPage> {
  const params = new URLSearchParams({ take: "50" });
  if (q) params.set("q", q);
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/image/conversations?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await parseError(res, "读取会话失败"));
  const data = await res.json();
  return {
    conversations: data.conversations,
    hasMore: Boolean(data.hasMore),
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
  };
}

export async function createConversation(): Promise<ConversationSummary> {
  const res = await fetch("/api/image/conversations", { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "新建会话失败"));
  const data = await res.json();
  return data.conversation;
}

export async function getConversation(
  id: string,
  options?: { before?: string; take?: number }
): Promise<ConversationSnapshot> {
  const params = new URLSearchParams();
  params.set("take", String(options?.take ?? 8));
  if (options?.before) params.set("before", options.before);
  const query = params.toString();
  const res = await fetch(`/api/image/conversations/${id}${query ? `?${query}` : ""}`);
  if (!res.ok) throw new Error(await parseError(res, "读取会话详情失败"));
  const data = await res.json();
  return {
    conversation: data.conversation,
    balance: readBalance(data.balance),
  };
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/image/conversations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(await parseError(res, "重命名失败"));
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/image/conversations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "删除失败"));
}

export async function clearConversations(): Promise<void> {
  const res = await fetch("/api/image/conversations?all=1", { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "清空失败"));
}

export async function cancelTurn(turnId: string): Promise<CancelTurnResult> {
  const res = await fetch(`/api/image/turns/${turnId}/cancel`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "停止生成失败"));
  const data = await res.json();
  return { turn: data.turn, balance: readBalance(data.balance) };
}

// 文生图
export async function generateTurn(input: {
  conversationId?: string;
  prompt: string;
  ratio: string;
  quality?: string;
  count: number;
  model?: string;
  modelSource?: ModelSource;
}): Promise<{ turn: Turn; conversationId: string }> {
  const res = await fetch("/api/image/turns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res, "生成失败"));
  return res.json();
}

async function readTurnStream(res: Response, onEvent: (event: TurnStreamEvent) => void): Promise<void> {
  if (!res.ok) throw new Error(await parseError(res, "生成失败"));
  if (!res.body) throw new Error("生成接口未返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      onEvent(JSON.parse(text) as TurnStreamEvent);
    }
  }

  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as TurnStreamEvent);
}

export async function generateTurnStream(
  input: {
    conversationId?: string;
    prompt: string;
    ratio: string;
    quality?: string;
    count: number;
    model?: string;
    modelSource?: ModelSource;
  },
  onEvent: (event: TurnStreamEvent) => void,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const res = await fetch("/api/image/turns/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: options?.signal,
  });
  await readTurnStream(res, onEvent);
}

// 图生图
export async function editTurn(input: {
  conversationId?: string;
  prompt: string;
  ratio: string;
  quality?: string;
  count: number;
  model?: string;
  modelSource?: ModelSource;
  image: File;
  referenceThumb?: string;
}): Promise<{ turn: Turn; conversationId: string }> {
  const form = new FormData();
  if (input.conversationId) form.append("conversationId", input.conversationId);
  form.append("prompt", input.prompt);
  form.append("ratio", input.ratio);
  form.append("quality", input.quality || "standard");
  form.append("count", String(input.count));
  if (input.model) form.append("model", input.model);
  if (input.modelSource) form.append("modelSource", input.modelSource);
  form.append("image", input.image);
  if (input.referenceThumb) form.append("referenceThumb", input.referenceThumb);

  const res = await fetch("/api/image/turns/edit", { method: "POST", body: form });
  if (!res.ok) throw new Error(await parseError(res, "生成失败"));
  return res.json();
}

export async function editTurnStream(
  input: {
    conversationId?: string;
    prompt: string;
    ratio: string;
    quality?: string;
    count: number;
    model?: string;
    modelSource?: ModelSource;
    image: File;
    referenceThumb?: string;
  },
  onEvent: (event: TurnStreamEvent) => void,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const form = new FormData();
  if (input.conversationId) form.append("conversationId", input.conversationId);
  form.append("prompt", input.prompt);
  form.append("ratio", input.ratio);
  form.append("quality", input.quality || "standard");
  form.append("count", String(input.count));
  if (input.model) form.append("model", input.model);
  if (input.modelSource) form.append("modelSource", input.modelSource);
  form.append("image", input.image);
  if (input.referenceThumb) form.append("referenceThumb", input.referenceThumb);

  const res = await fetch("/api/image/turns/edit/stream", {
    method: "POST",
    body: form,
    signal: options?.signal,
  });
  await readTurnStream(res, onEvent);
}
