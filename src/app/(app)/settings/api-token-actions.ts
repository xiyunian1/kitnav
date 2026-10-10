"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  API_TOKEN_EXPIRY_DAYS,
  ApiTokenError,
  createApiAccessToken,
  revokeApiAccessToken,
} from "@/lib/api-access-tokens";

const createSchema = z.object({
  name: z.string().trim().min(1, "请填写令牌名称").max(40, "名称不超过 40 个字"),
  expiresInDays: z.enum(["never", ...API_TOKEN_EXPIRY_DAYS.map(String)] as [string, ...string[]]),
});

export async function createApiTokenAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  const parsed = createSchema.safeParse({
    name: formData.get("name")?.toString() ?? "",
    expiresInDays: formData.get("expiresInDays")?.toString() ?? "90",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  try {
    const { token, record } = await createApiAccessToken({
      userId: session.user.id,
      name: parsed.data.name,
      expiresInDays: parsed.data.expiresInDays === "never" ? null : Number(parsed.data.expiresInDays),
    });
    revalidatePath("/settings");
    return { token, name: record.name };
  } catch (error) {
    return { error: error instanceof ApiTokenError ? error.message : "创建失败，请稍后再试" };
  }
}

export async function revokeApiTokenAction(id: string) {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  const revoked = await revokeApiAccessToken(session.user.id, String(id).slice(0, 64));
  revalidatePath("/settings");
  return revoked ? { ok: true } : { error: "令牌不存在或已撤销" };
}
