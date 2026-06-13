"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import {
  MODULE_CONTROL_DEFINITIONS,
  MODULE_CONTROL_STATUSES,
  updateModuleControls,
} from "@/lib/module-controls";

const MODULE_KEYS = MODULE_CONTROL_DEFINITIONS.map((item) => item.key);

export async function updateModuleControlsAction(formData: FormData) {
  if (!(await isAdmin())) return { error: "无权限" };

  const updates = MODULE_KEYS.map((key) => {
    const status = String(formData.get(`status:${key}`) || "");
    const message = String(formData.get(`message:${key}`) || "").trim();
    if (!MODULE_CONTROL_STATUSES.includes(status as never)) {
      throw new Error("模块状态无效");
    }
    return { key, status, message };
  });

  try {
    const saved = await updateModuleControls(updates);
    await writeAuditLog({
      action: "modules.update",
      target: "modules",
      detail: saved,
    });
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
