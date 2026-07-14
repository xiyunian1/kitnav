"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAdminId } from "@/lib/admin-guard";
import { runAuditedAdminTransaction } from "@/lib/audit";

async function guard() {
  const adminId = await getActiveAdminId();
  if (!adminId) throw new Error("无权限");
  return adminId;
}

const packageSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  credits: z.number().int().positive().max(1_000_000_000),
  amount: z.number().int().positive().max(1_000_000_000),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  enabled: z.boolean().default(true),
  popular: z.boolean().default(false),
});

export async function saveRechargePackageAction(input: z.infer<typeof packageSchema>) {
  const adminId = await guard();
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  const { id, ...data } = parsed.data;
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      id
        ? tx.rechargePackage.update({ where: { id }, data })
        : tx.rechargePackage.create({ data }),
    (pkg) => ({
      action: "recharge-package.save",
      target: pkg.id,
      detail: data,
    }),
  );
  revalidatePath("/admin/operations");
  revalidatePath("/credits");
  return { ok: true };
}

export async function deleteRechargePackageAction(id: string) {
  const adminId = await guard();
  const parsed = z.string().min(1).max(100).safeParse(id);
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) => tx.rechargePackage.delete({ where: { id: parsed.data } }),
    { action: "recharge-package.delete", target: parsed.data },
  );
  revalidatePath("/admin/operations");
  revalidatePath("/credits");
  return { ok: true };
}

const inviteSchema = z.object({
  code: z.string().trim().min(3).max(64),
  maxUses: z.number().int().positive().max(1_000_000),
  note: z.string().trim().max(100).optional(),
});

export async function createInviteCodeAction(input: z.infer<typeof inviteSchema>) {
  const adminId = await guard();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) => tx.inviteCode.create({ data: parsed.data }),
    (invite) => ({
      action: "invite.create",
      target: invite.code,
      detail: parsed.data,
    }),
  );
  revalidatePath("/admin/operations");
  return { ok: true };
}

export async function toggleInviteCodeAction(id: string, enabled: boolean) {
  const adminId = await guard();
  const parsed = z
    .object({ id: z.string().min(1).max(100), enabled: z.boolean() })
    .safeParse({ id, enabled });
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.inviteCode.update({
        where: { id: parsed.data.id },
        data: { enabled: parsed.data.enabled },
      }),
    (invite) => ({
      action: "invite.toggle",
      target: invite.code,
      detail: { enabled: parsed.data.enabled },
    }),
  );
  revalidatePath("/admin/operations");
  return { ok: true };
}
