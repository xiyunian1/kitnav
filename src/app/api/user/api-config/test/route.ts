import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { testImageConnection, testTextConnection } from "@/lib/providers";
import { testConnectionSchema } from "@/lib/api-config-schema";
import { getCurrentUserOrUnauthorized } from "@/lib/current-user";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

// 用户测试自己的 API 配置连接。apiKey 留空则用已存的 key 测试。
export async function POST(req: Request) {
  const current = await getCurrentUserOrUnauthorized();
  if ("error" in current) {
    return NextResponse.json({ ok: false, error: current.error }, { status: current.status });
  }
  const userId = current.user.id;
  const limited = await enforceUserRequestLimit(userId, REQUEST_LIMITS.apiProbe);
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await readLimitedJsonBody(req, JSON_BODY_LIMITS.small);
  } catch (error) {
    const bodyError = jsonRequestErrorDetails(error);
    return NextResponse.json(
      { error: bodyError.message },
      { status: bodyError.status },
    );
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

  const result =
    module === "PROMPT_OPTIMIZER" || module === "PPT"
      ? await testTextConnection({ baseUrl, apiKey: key, model })
      : await testImageConnection({ baseUrl, apiKey: key, model });
  return NextResponse.json(result);
}
