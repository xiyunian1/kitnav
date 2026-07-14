"use server";

import { revalidatePath } from "next/cache";
import { getActiveAdminId } from "@/lib/admin-guard";
import { runAuditedAdminTransaction } from "@/lib/audit";
import {
  MODULE_CONTROL_DEFINITIONS,
  MODULE_CONTROL_STATUSES,
  updateModuleControlsInTransaction,
} from "@/lib/module-controls";

const MODULE_KEYS = MODULE_CONTROL_DEFINITIONS.map((item) => item.key);

export async function updateModuleControlsAction(formData: FormData) {
  const adminId = await getActiveAdminId();
  if (!adminId) return { error: "无权限" };

  try {
    const updates = MODULE_KEYS.map((key) => {
      const status = String(formData.get(`status:${key}`) || "");
      const message = String(formData.get(`message:${key}`) || "").trim();
      if (!MODULE_CONTROL_STATUSES.includes(status as never)) {
        throw new Error("模块状态无效");
      }
      if (message.length > 300) throw new Error("模块提示不能超过 300 字");
      return { key, status, message };
    });
    await runAuditedAdminTransaction(
      adminId,
      (tx) => updateModuleControlsInTransaction(tx, updates),
      (saved) => ({
        action: "modules.update",
        target: "modules",
        detail: saved,
      }),
    );
  } catch (error) {
    return { error: error instanceof Error ? error.message : "保存失败" };
  }

  revalidatePath("/admin/modules");
  revalidatePath("/", "layout");
  revalidatePath("/");
  revalidatePath("/image");
  revalidatePath("/materials");
  revalidatePath("/library");
  revalidatePath("/credits");
  revalidatePath("/feedback");
  return { ok: true };
}
