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

const materialIdSchema = z.string().min(1).max(100);

export async function approveMaterialAction(materialId: string) {
  const adminId = await guard();
  const parsed = materialIdSchema.safeParse(materialId);
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.material.update({
        where: { id: parsed.data },
        data: {
          visibility: "PUBLIC",
          status: "APPROVED",
          rejectionReason: null,
          reviewedAt: new Date(),
        },
      }),
    { action: "material.approve", target: parsed.data },
  );
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { ok: true };
}

const rejectSchema = z.object({
  materialId: materialIdSchema,
  reason: z.string().trim().min(1, "请填写拒绝原因").max(200, "拒绝原因不能超过 200 字"),
});

export async function rejectMaterialAction(materialId: string, reason: string) {
  const adminId = await guard();
  const parsed = rejectSchema.safeParse({ materialId, reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.material.update({
        where: { id: parsed.data.materialId },
        data: {
          visibility: "PRIVATE",
          status: "REJECTED",
          rejectionReason: parsed.data.reason,
          reviewedAt: new Date(),
        },
      }),
    {
      action: "material.reject",
      target: parsed.data.materialId,
      detail: { reason: parsed.data.reason },
    },
  );
  revalidatePath("/admin/materials");
  revalidatePath("/library");
  return { ok: true };
}

export async function archiveMaterialAction(materialId: string) {
  const adminId = await guard();
  const parsed = materialIdSchema.safeParse(materialId);
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.material.update({
        where: { id: parsed.data },
        data: {
          visibility: "PUBLIC",
          status: "ARCHIVED",
          reviewedAt: new Date(),
        },
      }),
    { action: "material.archive", target: parsed.data },
  );
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { ok: true };
}

export async function resolveMaterialReportsAction(materialId: string, status: "RESOLVED" | "DISMISSED") {
  const adminId = await guard();
  const parsed = z
    .object({
      materialId: materialIdSchema,
      status: z.enum(["RESOLVED", "DISMISSED"]),
    })
    .safeParse({ materialId, status });
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.materialReport.updateMany({
        where: { materialId: parsed.data.materialId, status: "OPEN" },
        data: { status: parsed.data.status, resolvedAt: new Date() },
      }),
    {
      action: "material.reports.resolve",
      target: parsed.data.materialId,
      detail: { status: parsed.data.status },
    },
  );
  revalidatePath("/admin/materials");
  return { ok: true };
}
