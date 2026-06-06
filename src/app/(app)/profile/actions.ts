"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  current: z.string().min(1),
  next: z.string().min(6, "新密码至少 6 位"),
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

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.passwordHash) return { error: "账号异常" };

  const valid = await bcrypt.compare(parsed.data.current, user.passwordHash);
  if (!valid) return { error: "当前密码错误" };

  const passwordHash = await bcrypt.hash(parsed.data.next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return { ok: true };
}
