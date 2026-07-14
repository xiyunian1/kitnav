import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { listModels } from "@/lib/providers";
import { listModelsSchema } from "@/lib/api-config-schema";
import {
  enforceIpRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false, error: "无权限" }, { status: 403 });
  }
  const limited = await enforceIpRequestLimit(req, {
    ...REQUEST_LIMITS.apiProbe,
    prefix: "admin-api-probe",
  });
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await readLimitedJsonBody(req, JSON_BODY_LIMITS.small);
  } catch (error) {
    const bodyError = jsonRequestErrorDetails(error);
    return NextResponse.json(
      { ok: false, error: bodyError.message },
      { status: bodyError.status },
    );
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
    const existing = await prisma.providerConfig.findUnique({ where: { module } });
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "请填写 API Key" },
        { status: 400 }
      );
    }
    key = decrypt(existing.apiKey);
  }

  const result = await listModels({
    baseUrl,
    apiKey: key,
    networkPolicy: "trusted",
  });
  return NextResponse.json(result);
}
