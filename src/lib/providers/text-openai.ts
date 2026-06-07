import type { ProviderCredentials } from "./types";

export interface TextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextGenerationParams {
  messages: TextMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class OpenAITextProvider {
  readonly name = "openai-compatible-text";

  constructor(private readonly creds: ProviderCredentials) {}

  async generateText(params: TextGenerationParams) {
    const res = await fetch(`${this.creds.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.creds.apiKey}`,
      },
      body: JSON.stringify({
        model: this.creds.model,
        temperature: params.temperature ?? 0.4,
        max_tokens: params.maxTokens,
        messages: params.messages,
      }),
      signal: params.signal ?? AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const data = await res.json();
        detail = data?.error?.message || data?.message || JSON.stringify(data);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new Error(`上游返回 ${res.status}：${detail.slice(0, 300) || "请求失败"}`);
    }

    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("上游没有返回文本内容");
    return text;
  }
}
