import type { ProviderCredentials } from "./types";
import { OpenAIImageProvider } from "./image-openai";

export interface TestResult {
  ok: boolean;
  error?: string;
}

// 测试图片 API 连接：用最小参数发一次真实请求，验证 Base URL / Key / 模型是否可用。
// 会消耗一点上游额度。供后台和用户设置页的「测试连接」复用。
export async function testImageConnection(
  creds: ProviderCredentials
): Promise<TestResult> {
  if (!creds.baseUrl || !creds.apiKey || !creds.model) {
    return { ok: false, error: "请填写完整的 Base URL、API Key 和模型名" };
  }
  try {
    const provider = new OpenAIImageProvider(creds);
    const result = await provider.generate({
      prompt: "test connection, a small red dot",
      size: "1024x1024",
      count: 1,
    });
    if (result.urls.length > 0) {
      return { ok: true };
    }
    return { ok: false, error: "上游未返回图片" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "连接失败" };
  }
}
