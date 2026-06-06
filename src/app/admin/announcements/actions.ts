"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

const announcementSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(1000),
  placement: z.string().trim().min(1).max(30).default("APP"),
  enabled: z.boolean().default(true),
});

export async function saveAnnouncementAction(input: z.infer<typeof announcementSchema>) {
  if (!(await isAdmin())) return { error: "无权限" };
  const parsed = announcementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  const { id, ...data } = parsed.data;
  const item = id
    ? await prisma.siteAnnouncement.update({ where: { id }, data })
    : await prisma.siteAnnouncement.create({ data });
  await writeAuditLog({ action: "announcement.save", target: item.id, detail: data });
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteAnnouncementAction(id: string) {
  if (!(await isAdmin())) return { error: "无权限" };
  await prisma.siteAnnouncement.delete({ where: { id } });
  await writeAuditLog({ action: "announcement.delete", target: id });
  revalidatePath("/admin/announcements");
  revalidatePath("/", "layout");
  return { ok: true };
}
