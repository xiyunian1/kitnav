import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { MODULE_TYPES } from "@/lib/api-config-schema";
import { getCurrentUserOrUnauthorized } from "@/lib/current-user";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

const schema = z.object({
  module: z.enum(MODULE_TYPES),
  enabled: z.boolean(),
});

export async function POST(req: Request) {
  const current = await getCurrentUserOrUnauthorized();
  if ("error" in current) {
    return NextResponse.json({ error: current.error }, { status: current.status });
  }

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

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  const existing = await prisma.userApiConfig.findUnique({
    where: {
      userId_module: {
        userId: current.user.id,
        module: parsed.data.module,
      },
    },
    select: { id: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "请先保存 API 配置" }, { status: 400 });
  }

  await prisma.userApiConfig.update({
    where: { id: existing.id },
    data: { enabled: parsed.data.enabled },
  });

  return NextResponse.json({ ok: true });
}
