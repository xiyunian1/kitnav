"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

async function guard() {
  if (!(await isAdmin())) throw new Error("无权限");
}

const packageSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  credits: z.number().int().positive(),
  amount: z.number().int().positive(),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  popular: z.boolean().default(false),
});

export async function saveRechargePackageAction(input: z.infer<typeof packageSchema>) {
  await guard();
  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  const { id, ...data } = parsed.data;
  const pkg = id
    ? await prisma.rechargePackage.update({ where: { id }, data })
    : await prisma.rechargePackage.create({ data });
  await writeAuditLog({ action: "recharge-package.save", target: pkg.id, detail: data });
  revalidatePath("/admin/operations");
  revalidatePath("/credits");
  return { ok: true };
}

export async function deleteRechargePackageAction(id: string) {
  await guard();
  await prisma.rechargePackage.delete({ where: { id } });
  await writeAuditLog({ action: "recharge-package.delete", target: id });
  revalidatePath("/admin/operations");
  revalidatePath("/credits");
  return { ok: true };
}

const inviteSchema = z.object({
  code: z.string().trim().min(3).max(64),
  maxUses: z.number().int().positive(),
  note: z.string().trim().max(100).optional(),
});

export async function createInviteCodeAction(input: z.infer<typeof inviteSchema>) {
  await guard();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  const invite = await prisma.inviteCode.create({ data: parsed.data });
  await writeAuditLog({ action: "invite.create", target: invite.code, detail: parsed.data });
  revalidatePath("/admin/operations");
  return { ok: true };
}

export async function toggleInviteCodeAction(id: string, enabled: boolean) {
  await guard();
  const invite = await prisma.inviteCode.update({ where: { id }, data: { enabled } });
  await writeAuditLog({ action: "invite.toggle", target: invite.code, detail: { enabled } });
  revalidatePath("/admin/operations");
  return { ok: true };
}
