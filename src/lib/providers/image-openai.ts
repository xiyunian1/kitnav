import type {
  ImageProvider,
  ImageGenerationParams,
  ImageEditParams,
  GenerationResult,
  ProviderCredentials,
} from "./types";
import { UpstreamImageError } from "./types";

const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 180_000;

function normalizeTimeoutMs(timeoutMs?: number) {
  if (timeoutMs === 0) return 0;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
  }
  return Math.floor(timeoutMs);
}

// OpenAI 兼容的图片生成 Provider。
// 文生图调 {baseUrl}/images/generations，图生图调 {baseUrl}/images/edits，
// 兼容 OpenAI 官方及各类聚合站（new-api/one-api 等）。
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  private readonly creds: ProviderCredentials;

  constructor(creds: ProviderCredentials) {
    this.creds = creds;
  }

  private baseUrl(): string {
    return this.creds.baseUrl.replace(/\/+$/, "");
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    connectErrorMessage: string,
    parentSignal?: AbortSignal
  ): Promise<{ res: Response; elapsedMs: number }> {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer =
      timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      return { res, elapsedMs: Date.now() - startedAt };
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      if (parentSignal?.aborted) {
        throw new UpstreamImageError("用户已停止生成", undefined, elapsedMs);
      }
      if (
        controller.signal.aborted ||
        (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))
      ) {
        throw new UpstreamImageError(
          `上游响应超时（约 ${Math.round(elapsedMs / 1000)} 秒）`,
          undefined,
          elapsedMs
        );
      }
      throw new UpstreamImageError(connectErrorMessage, undefined, elapsedMs);
    } finally {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }

  // 统一处理上游错误响应：拼出可读信息后抛出。
  private async throwUpstreamError(res: Response, elapsedMs: number): Promise<never> {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.message || JSON.stringify(err);
    } catch {
      detail = await res.text().catch(() => "");
    }
    const suffix = detail.slice(0, 200) || "请求失败";
    const elapsed = `约 ${Math.round(elapsedMs / 1000)} 秒`;
    if (res.status === 524) {
      throw new UpstreamImageError(
        `上游网关超时（524，${elapsed}）：图片生成处理过久但未返回结果`,
        res.status,
        elapsedMs
      );
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new UpstreamImageError(
        `上游服务暂时不可用（${res.status}，${elapsed}）：${suffix}`,
        res.status,
        elapsedMs
      );
    }
    throw new UpstreamImageError(
      `上游返回 ${res.status}（${elapsed}）：${suffix}`,
      res.status,
      elapsedMs
    );
  }

  // 统一解析成功响应：兼容返回 url 或 b64_json 两种形式。
  private async parseImageResponse(res: Response, elapsedMs: number): Promise<GenerationResult> {
    const data = await res.json();
    const items: unknown[] = data?.data ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("上游未返回图片");
    }
    const urls = items.map((item) => {
      const it = item as { url?: string; b64_json?: string };
      if (it.url) return it.url;
      if (it.b64_json) return `data:image/png;base64,${it.b64_json}`;
      throw new Error("上游返回格式无法解析");
    });
    return { urls, elapsedMs };
  }

  async generate(params: ImageGenerationParams): Promise<GenerationResult> {
    const { apiKey, model } = this.creds;
    const url = `${this.baseUrl()}/images/generations`;

    const body: Record<string, unknown> = {
      model,
      prompt: params.prompt,
      n: Math.min(Math.max(params.count ?? 1, 1), 10),
      size: params.size ?? "1024x1024",
    };
    if (params.quality) body.quality = params.quality;

    let res: Response;
    let elapsedMs = 0;
    try {
      const out = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        normalizeTimeoutMs(params.timeoutMs),
        "无法连接上游服务，请检查 Base URL",
        params.signal
      );
      res = out.res;
      elapsedMs = out.elapsedMs;
    } catch (e) {
      throw e instanceof Error ? e : new Error("无法连接上游服务，请检查 Base URL");
    }

    if (!res.ok) {
      return this.throwUpstreamError(res, elapsedMs);
    }
    return this.parseImageResponse(res, elapsedMs);
  }

  async edit(params: ImageEditParams): Promise<GenerationResult> {
    const { apiKey, model } = this.creds;
    const url = `${this.baseUrl()}/images/edits`;

    let res: Response;
    let elapsedMs = 0;
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", params.prompt);
      form.append("n", String(Math.min(Math.max(params.count ?? 1, 1), 10)));
      if (params.size) form.append("size", params.size);
      if (params.quality) form.append("quality", params.quality);
      form.append("image", params.image, params.imageFilename || "reference.png");

      const out = await this.fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            // 不设 Content-Type，让 fetch 自动带 multipart boundary
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        },
        normalizeTimeoutMs(params.timeoutMs),
        "无法连接上游服务，请检查 Base URL",
        params.signal
      );
      res = out.res;
      elapsedMs = out.elapsedMs;
    } catch (e) {
      throw e instanceof Error ? e : new Error("无法连接上游服务，请检查 Base URL");
    }

    if (!res.ok) {
      // 4xx 多为模型不支持图生图，给更友好的提示
      if (res.status >= 400 && res.status < 500) {
        let detail = "";
        try {
          const err = await res.json();
          detail = err?.error?.message || err?.message || "";
        } catch {
          detail = "";
        }
        throw new UpstreamImageError(
          `图生图失败：当前模型「${model}」或当前上游通道可能不支持图片编辑${
            detail ? `。上游：${detail.slice(0, 150)}` : ""
          }`,
          res.status
        );
      }
      return this.throwUpstreamError(res, elapsedMs);
    }
    return this.parseImageResponse(res, elapsedMs);
  }
}
