"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

async function guard() {
  if (!(await isAdmin())) throw new Error("无权限");
}

export async function approveMaterialAction(materialId: string) {
  await guard();
  await prisma.material.update({
    where: { id: materialId },
    data: {
      visibility: "PUBLIC",
      status: "APPROVED",
      rejectionReason: null,
      reviewedAt: new Date(),
    },
  });
  await writeAuditLog({ action: "material.approve", target: materialId });
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { ok: true };
}

const rejectSchema = z.object({
  materialId: z.string().min(1),
  reason: z.string().trim().min(1, "请填写拒绝原因").max(200, "拒绝原因不能超过 200 字"),
});

export async function rejectMaterialAction(materialId: string, reason: string) {
  await guard();
  const parsed = rejectSchema.safeParse({ materialId, reason });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  await prisma.material.update({
    where: { id: parsed.data.materialId },
    data: {
      visibility: "PRIVATE",
      status: "REJECTED",
      rejectionReason: parsed.data.reason,
      reviewedAt: new Date(),
    },
  });
  await writeAuditLog({
    action: "material.reject",
    target: parsed.data.materialId,
    detail: { reason: parsed.data.reason },
  });
  revalidatePath("/admin/materials");
  revalidatePath("/library");
  return { ok: true };
}

export async function archiveMaterialAction(materialId: string) {
  await guard();
  await prisma.material.update({
    where: { id: materialId },
    data: { visibility: "PUBLIC", status: "ARCHIVED", reviewedAt: new Date() },
  });
  await writeAuditLog({ action: "material.archive", target: materialId });
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { ok: true };
}

export async function resolveMaterialReportsAction(materialId: string, status: "RESOLVED" | "DISMISSED") {
  await guard();
  await prisma.materialReport.updateMany({
    where: { materialId, status: "OPEN" },
    data: { status, resolvedAt: new Date() },
  });
  await writeAuditLog({ action: "material.reports.resolve", target: materialId, detail: { status } });
  revalidatePath("/admin/materials");
  return { ok: true };
}
