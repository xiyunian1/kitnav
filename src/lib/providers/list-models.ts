import {
  PublicUrlSafetyError,
  readBoundedJsonResponse,
  readBoundedResponseText,
} from "@/lib/safe-fetch";
import { fetchProviderEndpoint } from "./network";
import type { ProviderNetworkPolicy } from "./types";

const MAX_MODEL_LIST_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BYTES = 64 * 1024;

export interface ListModelsResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export async function listModels(creds: {
  baseUrl: string;
  apiKey: string;
  networkPolicy?: ProviderNetworkPolicy;
}): Promise<ListModelsResult> {
  if (!creds.baseUrl || !creds.apiKey) {
    return { ok: false, error: "请填写 Base URL 和 API Key" };
  }

  const url = `${creds.baseUrl.replace(/\/+$/, "")}/models`;

  let res: Response;
  try {
    res = await fetchProviderEndpoint(
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
      creds.networkPolicy,
    );
  } catch (e) {
    if (e instanceof PublicUrlSafetyError) {
      return { ok: false, error: e.message };
    }
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "上游响应超时" };
    }
    return { ok: false, error: "无法连接上游服务，请检查 Base URL" };
  }

  if (!res.ok) {
    let detail: unknown = "";
    try {
      const text = await readBoundedResponseText(
        res,
        MAX_ERROR_BYTES,
        "上游错误响应过大",
      );
      detail = errorDetail(text);
    } catch (error) {
      detail = error instanceof Error ? error.message : "";
    }
    return {
      ok: false,
      error: `上游返回 ${res.status}：${String(detail).slice(0, 200) || "请求失败"}`,
    };
  }

  let data: unknown;
  try {
    data = await readBoundedJsonResponse(
      res,
      MAX_MODEL_LIST_BYTES,
      "上游模型列表响应过大",
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "上游返回格式无法解析",
    };
  }

  const list = Array.isArray(data) ? data : (data as { data?: unknown })?.data;
  if (!Array.isArray(list)) {
    return { ok: false, error: "上游未返回模型列表" };
  }

  const models = list
    .map((m) => {
      if (typeof m === "string") return m;
      return (m as { id?: string })?.id;
    })
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const unique = Array.from(new Set(models)).sort();
  if (unique.length === 0) {
    return { ok: false, error: "上游未返回任何模型" };
  }

  return { ok: true, models: unique };
}

function errorDetail(text: string) {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return text;
    const record = parsed as Record<string, unknown>;
    const nested =
      record.error && typeof record.error === "object"
        ? (record.error as Record<string, unknown>)
        : null;
    return nested?.message ?? record.message ?? text;
  } catch {
    return text;
  }
}
