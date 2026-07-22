import type {
  ImageProvider,
  ImageGenerationParams,
  ImageEditParams,
  GenerationResult,
  ProviderCredentials,
} from "./types";
import { UpstreamImageError } from "./types";
import { fetchProviderEndpoint } from "./network";
import {
  PublicUrlSafetyError,
  readBoundedJsonResponse,
  readBoundedResponseText,
} from "@/lib/safe-fetch";
import { MAX_REFERENCE_IMAGE_COUNT } from "@/lib/image-edit-capabilities";

const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 180_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = 128 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;

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
      const res = await fetchProviderEndpoint(
        url,
        { ...init, signal: controller.signal },
        this.creds.networkPolicy,
      );
      return { res, elapsedMs: Date.now() - startedAt };
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      if (e instanceof PublicUrlSafetyError) {
        throw new UpstreamImageError(e.message, undefined, elapsedMs);
      }
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
      detail = await readErrorDetail(res);
    } catch (error) {
      detail = error instanceof Error ? error.message : "";
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
  private async parseImageResponse(
    res: Response,
    elapsedMs: number,
    expectedCount: number,
  ): Promise<GenerationResult> {
    const data = await readBoundedJsonResponse<{ data?: unknown }>(
      res,
      MAX_IMAGE_RESPONSE_BYTES,
      "上游图片响应过大",
    );
    const items = Array.isArray(data?.data) ? data.data : [];
    if (items.length === 0) {
      throw new Error("上游未返回图片");
    }
    const urls = items.slice(0, expectedCount).map((item) => {
      const it = item as { url?: unknown; b64_json?: unknown };
      if (typeof it.url === "string") return normalizeImageResultUrl(it.url);
      if (typeof it.b64_json === "string") {
        if (it.b64_json.length > MAX_BASE64_LENGTH) {
          throw new Error("上游返回图片超过 8MB");
        }
        return `data:image/png;base64,${it.b64_json}`;
      }
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
    return this.parseImageResponse(
      res,
      elapsedMs,
      Math.min(Math.max(params.count ?? 1, 1), 10),
    );
  }

  async edit(params: ImageEditParams): Promise<GenerationResult> {
    const { apiKey, model } = this.creds;
    const url = `${this.baseUrl()}/images/edits`;
    if (params.images.length < 1) throw new Error("请上传参考图");
    if (params.images.length > MAX_REFERENCE_IMAGE_COUNT) {
      throw new Error(`参考图最多上传 ${MAX_REFERENCE_IMAGE_COUNT} 张`);
    }

    let res: Response;
    let elapsedMs = 0;
    try {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", params.prompt);
      form.append("n", String(Math.min(Math.max(params.count ?? 1, 1), 10)));
      if (params.size) form.append("size", params.size);
      if (params.quality) form.append("quality", params.quality);
      if (params.images.length === 1) {
        const image = params.images[0];
        form.append("image", image.blob, image.filename || "reference.png");
      } else {
        for (const image of params.images) {
          form.append("image[]", image.blob, image.filename || "reference.png");
        }
      }

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
          detail = await readErrorDetail(res);
        } catch (error) {
          detail = error instanceof Error ? error.message : "";
        }
        throw new UpstreamImageError(
          params.images.length > 1
            ? `多参考图生成失败：上游通道未接受 ${params.images.length} 张参考图，请检查该通道是否完整转发 image[] 字段${
                detail ? `。上游：${detail.slice(0, 150)}` : ""
              }`
            : `图生图失败：当前模型「${model}」或当前上游通道可能不支持图片编辑${
                detail ? `。上游：${detail.slice(0, 150)}` : ""
              }`,
          res.status
        );
      }
      return this.throwUpstreamError(res, elapsedMs);
    }
    return this.parseImageResponse(
      res,
      elapsedMs,
      Math.min(Math.max(params.count ?? 1, 1), 10),
    );
  }
}

function normalizeImageResultUrl(rawUrl: string) {
  if (/^data:image\//i.test(rawUrl)) {
    if (rawUrl.length > MAX_BASE64_LENGTH + 64) {
      throw new Error("上游返回图片超过 8MB");
    }
    return rawUrl;
  }
  if (rawUrl.length > 4096) throw new Error("上游返回图片 URL 过长");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("上游返回了无效的图片 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("上游返回了不支持的图片 URL");
  }
  return rawUrl;
}

async function readErrorDetail(res: Response) {
  const text = await readBoundedResponseText(
    res,
    MAX_ERROR_RESPONSE_BYTES,
    "上游错误响应过大",
  );
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return text;
    const record = parsed as Record<string, unknown>;
    const nested =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    return String(nested?.message ?? record.message ?? text);
  } catch {
    return text;
  }
}
