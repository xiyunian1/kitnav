"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FeedbackStatus } from "@prisma/client";
import { getActiveAdminId } from "@/lib/admin-guard";
import { runAuditedAdminTransaction } from "@/lib/audit";

async function guard() {
  const adminId = await getActiveAdminId();
  if (!adminId) throw new Error("无权限");
  return adminId;
}

const updateSchema = z.object({
  feedbackId: z.string().min(1).max(100),
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
  adminNote: z.string().trim().max(1000, "备注不能超过 1000 个字").optional(),
});

export async function updateFeedbackAction(input: {
  feedbackId: string;
  status: FeedbackStatus;
  adminNote?: string;
}) {
  const adminId = await guard();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }

  await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.feedback.update({
        where: { id: parsed.data.feedbackId },
        data: {
          status: parsed.data.status,
          adminNote: parsed.data.adminNote || null,
        },
      }),
    {
      action: "feedback.update",
      target: parsed.data.feedbackId,
      detail: { status: parsed.data.status },
    },
  );

  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
  return { ok: true };
}
