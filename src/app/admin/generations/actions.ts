"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { failStuckImageTurns } from "@/lib/image-workbench";

export async function cleanupStuckImageTurnsAction() {
  if (!(await isAdmin())) throw new Error("无权限");

  const result = await failStuckImageTurns();
  await writeAuditLog({
    action: "generation.cleanup-stuck",
    detail: result,
  });
  revalidatePath("/admin/generations");
  revalidatePath("/admin/analytics");
  return { ok: true, ...result };
}
