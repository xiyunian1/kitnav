"use server";

import { revalidatePath } from "next/cache";
import { getActiveAdminId } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { failStuckImageTurns } from "@/lib/image-workbench";

export async function cleanupStuckImageTurnsAction() {
  const adminId = await getActiveAdminId();
  if (!adminId) throw new Error("无权限");

  const result = await failStuckImageTurns();
  await writeAuditLog({
    adminId,
    action: "generation.cleanup-stuck",
    detail: result,
  });
  revalidatePath("/admin/generations");
  revalidatePath("/admin/analytics");
  return { ok: true, ...result };
}
