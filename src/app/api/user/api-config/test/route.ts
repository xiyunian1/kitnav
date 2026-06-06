import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { testImageConnection } from "@/lib/providers";
import { testConnectionSchema } from "@/lib/api-config-schema";

// 用户测试自己的 API 配置连接。apiKey 留空则用已存的 key 测试。
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = testConnectionSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  const { module, baseUrl, apiKey, model } = parsed.data;

  // apiKey 留空时取已存的
  let key = apiKey;
  if (!key) {
    const existing = await prisma.userApiConfig.findUnique({
      where: { userId_module: { userId, module } },
    });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "请填写 API Key" },
        { status: 400 }
      );
    }
    key = decrypt(existing.apiKey);
  }

  // 目前仅图片模块支持真实测试
  const result = await testImageConnection({ baseUrl, apiKey: key, model });
  return NextResponse.json(result);
}
