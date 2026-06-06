"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { adjustCredits } from "@/lib/credits";
import { writeAuditLog } from "@/lib/audit";

async function guard() {
  if (!(await isAdmin())) throw new Error("无权限");
}

// 改角色
export async function setUserRoleAction(userId: string, role: "USER" | "ADMIN") {
  await guard();
  await prisma.user.update({ where: { id: userId }, data: { role } });
  await writeAuditLog({ action: "user.role.update", target: userId, detail: { role } });
  revalidatePath("/admin/users");
  return { ok: true };
}

// 封禁/解封
export async function setUserStatusAction(
  userId: string,
  status: "ACTIVE" | "BANNED"
) {
  await guard();
  await prisma.user.update({ where: { id: userId }, data: { status } });
  await writeAuditLog({ action: "user.status.update", target: userId, detail: { status } });
  revalidatePath("/admin/users");
  return { ok: true };
}

// 调整积分（正负皆可）
const adjustSchema = z.object({
  userId: z.string().min(1),
  delta: z.number().int().refine((n) => n !== 0, "调整值不能为 0"),
  reason: z.string().trim().max(100).optional(),
});

export async function adjustUserCreditsAction(
  userId: string,
  delta: number,
  reason?: string
) {
  await guard();
  const parsed = adjustSchema.safeParse({ userId, delta, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }
  try {
    await adjustCredits(userId, delta, reason || "管理员调整");
    await writeAuditLog({
      action: "user.credits.adjust",
      target: userId,
      detail: { delta, reason: reason || "管理员调整" },
    });
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "调整失败" };
  }
}
