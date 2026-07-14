"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  AUTH_INPUT_LIMITS,
  fitsBcryptPasswordLimit,
} from "@/lib/auth-inputs";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";

const profileSchema = z.object({
  name: z.string().trim().max(30).optional(),
});

export async function updateProfileAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = profileSchema.safeParse({
    name: formData.get("name")?.toString(),
  });
  if (!parsed.success) return { error: "参数错误" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: parsed.data.name || null },
  });

  revalidatePath("/profile");
  return { ok: true };
}

const passwordSchema = z.object({
  current: z
    .string()
    .min(1)
    .max(AUTH_INPUT_LIMITS.loginPasswordCharacters, "当前密码过长"),
  next: z
    .string()
    .min(6, "新密码至少 6 位")
    .max(AUTH_INPUT_LIMITS.newPasswordCharacters, "新密码过长")
    .refine(
      fitsBcryptPasswordLimit,
      `新密码不能超过 ${AUTH_INPUT_LIMITS.bcryptPasswordBytes} 个 UTF-8 字节`,
    ),
});

export async function changePasswordAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = passwordSchema.safeParse({
    current: formData.get("current")?.toString(),
    next: formData.get("next")?.toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }

  const limited = await enforceUserRequestLimit(
    session.user.id,
    REQUEST_LIMITS.passwordChange,
  );
  if (limited) return { error: REQUEST_LIMITS.passwordChange.message };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) return { error: "账号异常" };

  const valid = await bcrypt.compare(parsed.data.current, user.passwordHash);
  if (!valid) return { error: "当前密码错误" };

  const passwordHash = await bcrypt.hash(parsed.data.next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
    },
  });

  return { ok: true };
}
