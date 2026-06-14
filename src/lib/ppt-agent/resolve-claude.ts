import { resolveTextProvider } from "@/lib/providers";

export async function resolvePptTextProvider(userId: string) {
  try {
    return await resolveTextProvider(userId, "PPT");
  } catch (error) {
    if (error instanceof Error && error.message === "图片服务尚未配置") {
      throw new Error("PPT 生成尚未配置可用文本模型，请先在 API 设置或后台 API 配置中启用 PPT。");
    }
    throw error;
  }
}
