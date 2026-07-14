import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  assertRegistrationAllowed,
  createRegisteredUser,
  getRequestIp,
  OperationBlockedError,
} from "@/lib/operations";
import {
  enforceIpRequestLimit,
  enforceOpaqueValueLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
  AUTH_INPUT_LIMITS,
  fitsBcryptPasswordLimit,
} from "@/lib/auth-inputs";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .max(AUTH_INPUT_LIMITS.emailCharacters, "邮箱地址过长")
    .email("邮箱格式不正确")
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(6, "密码至少 6 位")
    .max(AUTH_INPUT_LIMITS.newPasswordCharacters, "密码过长")
    .refine(
      fitsBcryptPasswordLimit,
      `密码不能超过 ${AUTH_INPUT_LIMITS.bcryptPasswordBytes} 个 UTF-8 字节`,
    ),
  name: z.string().trim().max(30).optional(),
  inviteCode: z.string().trim().max(64).optional(),
});

export async function POST(req: Request) {
  const ipLimited = await enforceIpRequestLimit(req, REQUEST_LIMITS.register);
  if (ipLimited) return ipLimited;
  let body: unknown;
  try {
    body = await readLimitedJsonBody(req, JSON_BODY_LIMITS.small);
  } catch (error) {
    const bodyError = jsonRequestErrorDetails(error);
    return NextResponse.json(
      { error: bodyError.message },
      { status: bodyError.status },
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  const { email, password, name, inviteCode } = parsed.data;
  const emailLimited = await enforceOpaqueValueLimit(
    email.trim().toLowerCase(),
    { ...REQUEST_LIMITS.register, prefix: "register-email" },
  );
  if (emailLimited) return emailLimited;
  const ip = getRequestIp(req);

  try {
    await assertRegistrationAllowed({
      provider: "credentials",
      email,
      ip,
      inviteCode,
    });
  } catch (error) {
    if (error instanceof OperationBlockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await createRegisteredUser({
      provider: "credentials",
      email,
      ip,
      inviteCode,
      passwordHash,
      name: name || email.split("@")[0],
    });
    return NextResponse.json({ ok: true, email: user.email });
  } catch (error) {
    if (error instanceof OperationBlockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
