"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { SETTING_META } from "@/lib/settings-config";
import { writeAuditLog } from "@/lib/audit";

export async function updateSettingsAction(formData: FormData) {
  if (!(await isAdmin())) return { error: "无权限" };

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
    updates.push({ key: meta.key, value: raw.trim() });
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.setting.upsert({
        where: { key: u.key },
        update: { value: u.value },
        create: { key: u.key, value: u.value },
      })
    )
  );

  await writeAuditLog({
    action: "settings.update",
    target: "settings",
    detail: updates,
  });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/operations");
  revalidatePath("/", "layout");
  return { ok: true };
}
