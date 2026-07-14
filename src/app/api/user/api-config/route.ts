import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { apiConfigSchema } from "@/lib/api-config-schema";
import { modelListToJson } from "@/lib/model-options";
import { getCurrentUserOrUnauthorized } from "@/lib/current-user";
import { pptModelOptionsToJson } from "@/lib/ppt-agent/model-options";
import { assertSafePublicApiUrl } from "@/lib/safe-fetch";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

// 用户保存自己某模块的 API 配置（BYOK）。apiKey 留空表示沿用已存的 key。
export async function POST(req: Request) {
  const current = await getCurrentUserOrUnauthorized();
  if ("error" in current) {
    return NextResponse.json({ error: current.error }, { status: current.status });
  }
  const userId = current.user.id;

  let raw: unknown;
  try {
    raw = await readLimitedJsonBody(req, JSON_BODY_LIMITS.standard);
  } catch (error) {
    const bodyError = jsonRequestErrorDetails(error);
    return NextResponse.json(
      { error: bodyError.message },
      { status: bodyError.status },
    );
  }

  const parsed = apiConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  const { module, baseUrl, apiKey, model, models, modelOptions, enabled } = parsed.data;

  try {
    await assertSafePublicApiUrl(baseUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "API Base URL 不安全" },
      { status: 400 },
    );
  }

  const existing = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module } },
  });

  // apiKey 留空：必须已有旧 key 才允许（否则没法启用）
  if (!apiKey && !existing) {
    return NextResponse.json({ error: "请填写 API Key" }, { status: 400 });
  }

  const encryptedKey = apiKey ? encrypt(apiKey) : existing!.apiKey;

  await prisma.userApiConfig.upsert({
    where: { userId_module: { userId, module } },
    update: {
      baseUrl,
      apiKey: encryptedKey,
      model,
      models: modelListToJson(models ?? [], model),
      modelOptions: module === "PPT" ? pptModelOptionsToJson(modelOptions) : null,
      enabled,
    },
    create: {
      userId,
      module,
      baseUrl,
      apiKey: encryptedKey,
      model,
      models: modelListToJson(models ?? [], model),
      modelOptions: module === "PPT" ? pptModelOptionsToJson(modelOptions) : null,
      enabled,
    },
  });

  return NextResponse.json({ ok: true });
}
