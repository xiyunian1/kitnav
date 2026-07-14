"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAdminId } from "@/lib/admin-guard";
import { runAuditedAdminTransaction } from "@/lib/audit";

const announcementSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(1000),
  placement: z.string().trim().min(1).max(30).default("APP"),
  enabled: z.boolean().default(true),
});

export async function saveAnnouncementAction(input: z.infer<typeof announcementSchema>) {
  const adminId = await getActiveAdminId();
  if (!adminId) return { error: "无权限" };
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  const { id, ...data } = parsed.data;
  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      id
        ? tx.siteAnnouncement.update({ where: { id }, data })
        : tx.siteAnnouncement.create({ data }),
    (item) => ({
      action: "announcement.save",
      target: item.id,
      detail: data,
    }),
  );
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAnnouncementAction(id: string) {
  const adminId = await getActiveAdminId();
  if (!adminId) return { error: "无权限" };
  const parsed = z.string().min(1).max(100).safeParse(id);
  if (!parsed.success) return { error: "参数错误" };
  await runAuditedAdminTransaction(
    adminId,
    (tx) => tx.siteAnnouncement.delete({ where: { id: parsed.data } }),
    { action: "announcement.delete", target: parsed.data },
  );
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return { ok: true };
}
