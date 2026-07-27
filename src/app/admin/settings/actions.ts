"use server";

import { revalidatePath } from "next/cache";
import { getActiveAdminId } from "@/lib/admin-guard";
import { SETTING_META } from "@/lib/settings-config";
import { runAuditedAdminTransaction } from "@/lib/audit";
import { invalidateCache, CACHE_KEYS } from "@/lib/redis-cache";

export async function updateSettingsAction(formData: FormData) {
  const adminId = await getActiveAdminId();
  if (!adminId) return { error: "无权限" };

  const updates: { key: string; value: string }[] = [];
  for (const meta of SETTING_META) {
    const raw = formData.get(meta.key)?.toString();
    if (raw === undefined) continue;

    // number 类型校验
    if (meta.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { error: `「${meta.label}」必须为数字` };
      }
      if (meta.integer && !Number.isInteger(n)) {
        return { error: `「${meta.label}」必须为整数` };
      }
      if (n < (meta.min ?? 0)) {
        return { error: `「${meta.label}」不能小于 ${meta.min ?? 0}` };
      }
      if (meta.max !== undefined && n > meta.max) {
        return { error: `「${meta.label}」不能大于 ${meta.max}` };
      }
    }
    if (meta.type === "text" && raw.trim() === "" && !meta.allowEmpty) {
      return { error: `「${meta.label}」不能为空` };
    }
    if (meta.options && !meta.options.some((option) => option.value === raw.trim())) {
      return { error: `「${meta.label}」选项无效` };
    }
    updates.push({ key: meta.key, value: raw.trim() });
  }

  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      Promise.all(
        updates.map((update) =>
          tx.setting.upsert({
            where: { key: update.key },
            update: { value: update.value },
            create: { key: update.key, value: update.value },
          }),
        ),
      ),
    {
      action: "settings.update",
      target: "settings",
      detail: updates,
    },
  );
  await invalidateCache(CACHE_KEYS.settingsAll);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/materials");
  revalidatePath("/admin/operations");
  revalidatePath("/", "layout");
  return { ok: true };
}
