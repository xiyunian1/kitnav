export interface ListModelsResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

export async function listModels(creds: {
  baseUrl: string;
  apiKey: string;
}): Promise<ListModelsResult> {
  if (!creds.baseUrl || !creds.apiKey) {
    return { ok: false, error: "请填写 Base URL 和 API Key" };
  }

  const url = `${creds.baseUrl.replace(/\/+$/, "")}/models`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${creds.apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { ok: false, error: "上游响应超时" };
    }
    return { ok: false, error: "无法连接上游服务，请检查 Base URL" };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || err?.message || JSON.stringify(err);
    } catch {
      detail = await res.text().catch(() => "");
    }
    return {
      ok: false,
      error: `上游返回 ${res.status}：${detail.slice(0, 200) || "请求失败"}`,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "上游返回格式无法解析" };
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
