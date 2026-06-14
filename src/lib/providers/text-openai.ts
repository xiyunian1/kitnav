import type { ProviderCredentials } from "./types";

export interface TextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface TextGenerationParams {
  messages: TextMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolChatParams extends TextGenerationParams {
  tools: ToolDefinition[];
  toolChoice?: "auto" | "none";
}

export interface ToolChatResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
}

export class OpenAITextProvider {
  readonly name = "openai-compatible-text";

  constructor(private readonly creds: ProviderCredentials) {}

  async generateText(params: TextGenerationParams) {
    const data = await this.createChatCompletion(params);
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("上游没有返回文本内容");
    return text;
  }

  async generateWithTools(params: ToolChatParams): Promise<ToolChatResult> {
    const data = await this.createChatCompletion(params);
    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const toolCalls = normalizeToolCalls(message.tool_calls);
    return {
      content: String(message.content || "").trim(),
      toolCalls,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
    };
  }

  private async createChatCompletion(params: TextGenerationParams | ToolChatParams) {
    const body: Record<string, unknown> = {
      model: this.creds.model,
      temperature: params.temperature ?? 0.4,
      max_tokens: params.maxTokens,
      messages: params.messages,
    };
    if ("tools" in params) {
      body.tools = params.tools;
      body.tool_choice = params.toolChoice ?? "auto";
    }

    const res = await this.fetchChatCompletion(body, params);
    if (!res.ok) {
      throw new Error(await formatUpstreamError(res));
    }

    return res.json();
  }

  private async fetchChatCompletion(body: Record<string, unknown>, params: TextGenerationParams | ToolChatParams) {
    const signal = buildRequestSignal(params.signal, params.timeoutMs ?? 180_000);
    return fetch(`${this.creds.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.creds.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  }
}

function buildRequestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  const controller = new AbortController();
  const abort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  if (signal.aborted) abort(signal);
  if (timeoutSignal.aborted) abort(timeoutSignal);
  signal.addEventListener("abort", () => abort(signal), { once: true });
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal), { once: true });
  return controller.signal;
}

async function readErrorDetail(res: Response) {
  try {
    const data = await res.json();
    return data?.error?.message || data?.message || JSON.stringify(data);
  } catch {
    return res.text().catch(() => "");
  }
}

function formatUpstreamErrorMessage(status: number, detail: string) {
  return `上游返回 ${status}：${detail.slice(0, 300) || "请求失败"}`;
}

async function formatUpstreamError(res: Response) {
  return formatUpstreamErrorMessage(res.status, await readErrorDetail(res));
}

function normalizeToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const id = typeof item?.id === "string" ? item.id : "";
      const name = typeof item?.function?.name === "string" ? item.function.name : "";
      const args =
        typeof item?.function?.arguments === "string"
          ? item.function.arguments
          : JSON.stringify(item?.function?.arguments || {});
      if (!id || !name) return null;
      return {
        id,
        type: "function" as const,
        function: {
          name,
          arguments: args,
        },
      };
    })
    .filter((item): item is ToolCall => Boolean(item));
}
