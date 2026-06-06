import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addCredits, getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import {
  assertRegistrationAllowed,
  getRequestIp,
  OperationBlockedError,
  recordRegistration,
} from "@/lib/operations";

const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位"),
  name: z.string().trim().max(30).optional(),
  inviteCode: z.string().trim().max(64).optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  const { email, password, name, inviteCode } = parsed.data;
  const ip = getRequestIp(req);

  try {
    await assertRegistrationAllowed({
      provider: "credentials",
      email,
      ip,
      inviteCode,
    });
  } catch (error) {
    const status = error instanceof OperationBlockedError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "暂不允许注册" },
      { status }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      name: name || email.split("@")[0],
      passwordHash,
      role: "USER",
    },
  });

  // 发放注册赠送积分
  const bonus = await getSettingNumber(SETTING_KEYS.SIGNUP_BONUS);
  if (bonus > 0) {
    await addCredits(user.id, bonus, "SIGNUP_BONUS", "注册赠送");
  }

  await recordRegistration({
    userId: user.id,
    email: user.email,
    provider: "credentials",
    ip,
    inviteCode,
  });

  return NextResponse.json({ ok: true, email: user.email });
}
