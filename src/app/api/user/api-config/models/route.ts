import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { listModels } from "@/lib/providers";
import { listModelsSchema } from "@/lib/api-config-schema";
import { getCurrentUserOrUnauthorized } from "@/lib/current-user";

export async function POST(req: Request) {
  const current = await getCurrentUserOrUnauthorized();
  if ("error" in current) {
    return NextResponse.json({ ok: false, error: current.error }, { status: current.status });
  }
  const userId = current.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  const parsed = listModelsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  const { module, baseUrl, apiKey } = parsed.data;

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

  const result = await listModels({ baseUrl, apiKey: key });
  return NextResponse.json(result);
}
