"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FeedbackModule, FeedbackType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveFeedbackScreenshots } from "@/lib/feedback";

const TYPE_VALUES = ["FEATURE", "BUG", "EXPERIENCE", "BILLING", "OTHER"] as const;
const MODULE_VALUES = ["IMAGE", "MATERIALS", "CREDITS", "AUTH", "PROFILE", "OTHER"] as const;

const feedbackSchema = z.object({
  type: z.enum(TYPE_VALUES),
  module: z.enum(MODULE_VALUES),
  title: z.string().trim().min(2, "标题至少 2 个字").max(80, "标题不能超过 80 个字"),
  content: z.string().trim().min(10, "请至少描述 10 个字").max(2000, "描述不能超过 2000 个字"),
  pagePath: z.string().trim().max(300).optional(),
});

export async function submitFeedbackAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = feedbackSchema.safeParse({
    type: formData.get("type"),
    module: formData.get("module"),
    title: formData.get("title"),
    content: formData.get("content"),
    pagePath: formData.get("pagePath") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }

  const screenshots = formData
    .getAll("screenshots")
    .filter((item): item is File => item instanceof File && item.size > 0);

  try {
    const screenshotUrls = await saveFeedbackScreenshots(screenshots, session.user.id);
    await prisma.feedback.create({
      data: {
        userId: session.user.id,
        type: parsed.data.type as FeedbackType,
        module: parsed.data.module as FeedbackModule,
        title: parsed.data.title,
        content: parsed.data.content,
        pagePath: parsed.data.pagePath || null,
        screenshotUrls: screenshotUrls.length ? JSON.stringify(screenshotUrls) : null,
      },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "提交失败" };
  }

  revalidatePath("/admin/feedback");
  return { ok: true };
}
