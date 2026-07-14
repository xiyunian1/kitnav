"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAdminId } from "@/lib/admin-guard";
import { adjustCreditsInTransaction } from "@/lib/credits";
import { runAuditedAdminTransaction } from "@/lib/audit";
import { updateUserAccessSafelyInTransaction } from "@/lib/admin-user-access";

async function guard() {
  const adminId = await getActiveAdminId();
  if (!adminId) throw new Error("无权限");
  return adminId;
}

// 改角色
export async function setUserRoleAction(userId: string, role: "USER" | "ADMIN") {
  const adminId = await guard();
  const parsed = z
    .object({ userId: z.string().min(1).max(100), role: z.enum(["USER", "ADMIN"]) })
    .safeParse({ userId, role });
  if (!parsed.success) return { error: "参数错误" };

  const result = await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      updateUserAccessSafelyInTransaction(tx, parsed.data.userId, {
        role: parsed.data.role,
      }),
    (updated) =>
      updated === "updated"
        ? {
            action: "user.role.update",
            target: parsed.data.userId,
            detail: { role: parsed.data.role },
          }
        : null,
  );
  if (result === "not-found") return { error: "用户不存在" };
  if (result === "last-active-admin") {
    return { error: "至少需要保留一个有效管理员账号" };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

// 封禁/解封
export async function setUserStatusAction(
  userId: string,
  status: "ACTIVE" | "BANNED"
) {
  const adminId = await guard();
  const parsed = z
    .object({
      userId: z.string().min(1).max(100),
      status: z.enum(["ACTIVE", "BANNED"]),
    })
    .safeParse({ userId, status });
  if (!parsed.success) return { error: "参数错误" };

  const result = await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      updateUserAccessSafelyInTransaction(tx, parsed.data.userId, {
        status: parsed.data.status,
      }),
    (updated) =>
      updated === "updated"
        ? {
            action: "user.status.update",
            target: parsed.data.userId,
            detail: { status: parsed.data.status },
          }
        : null,
  );
  if (result === "not-found") return { error: "用户不存在" };
  if (result === "last-active-admin") {
    return { error: "至少需要保留一个有效管理员账号" };
  }
  revalidatePath("/admin/users");
  return { ok: true };
}

// 调整积分（正负皆可）
const adjustSchema = z.object({
  userId: z.string().min(1).max(100),
  delta: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((n) => n !== 0, "调整值不能为 0"),
  reason: z.string().trim().max(100).optional(),
});

export async function adjustUserCreditsAction(
  userId: string,
  delta: number,
  reason?: string
) {
  const adminId = await guard();
  const parsed = adjustSchema.safeParse({ userId, delta, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }
  try {
    const description = parsed.data.reason || "管理员调整";
    await runAuditedAdminTransaction(
      adminId,
      (tx) =>
        adjustCreditsInTransaction(
          tx,
          parsed.data.userId,
          parsed.data.delta,
          description,
        ),
      {
        action: "user.credits.adjust",
        target: parsed.data.userId,
        detail: { delta: parsed.data.delta, reason: description },
      },
    );
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "调整失败" };
  }
}
