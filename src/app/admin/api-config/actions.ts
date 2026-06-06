"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { modelListToJson } from "@/lib/model-options";
import { modelMetaToJson } from "@/lib/model-meta";
import { testImageConnection } from "@/lib/providers";
import { writeAuditLog } from "@/lib/audit";
import {
  apiConfigSchema,
  testConnectionSchema,
  type ApiConfigInput,
} from "@/lib/api-config-schema";

// 保存平台上游配置（管理员）。apiKey 留空表示沿用已存的 key。
export async function saveProviderConfigAction(input: ApiConfigInput) {
  if (!(await isAdmin())) return { error: "无权限" };

  const parsed = apiConfigSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }
  const { module, baseUrl, apiKey, model, models, modelMeta, enabled } = parsed.data;

  const existing = await prisma.providerConfig.findUnique({ where: { module } });
  if (!apiKey && !existing) {
    return { error: "请填写 API Key" };
  }
  const encryptedKey = apiKey ? encrypt(apiKey) : existing!.apiKey;

  await prisma.providerConfig.upsert({
    where: { module },
    update: {
      baseUrl,
      apiKey: encryptedKey,
      model,
      models: modelListToJson(models ?? [], model),
      modelMeta: modelMeta ? modelMetaToJson(modelMeta) : undefined,
      enabled,
    },
    create: {
      module,
      baseUrl,
      apiKey: encryptedKey,
      model,
      models: modelListToJson(models ?? [], model),
      modelMeta: modelMeta ? modelMetaToJson(modelMeta) : undefined,
      enabled,
    },
  });

  await writeAuditLog({
    action: "provider.update",
    target: module,
    detail: { baseUrl, model, models, modelMeta, enabled, changedKey: Boolean(apiKey) },
  });
  revalidatePath("/admin/api-config");
  return { ok: true };
}

// 测试平台上游连接（管理员）。apiKey 留空则用已存的 key。
export async function testProviderConfigAction(input: {
  module: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
}) {
  if (!(await isAdmin())) return { ok: false, error: "无权限" };

  const parsed = testConnectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数错误" };
  }
  const { module, baseUrl, apiKey, model } = parsed.data;

  let key = apiKey;
  if (!key) {
    const existing = await prisma.providerConfig.findUnique({ where: { module } });
    if (!existing) return { ok: false, error: "请填写 API Key" };
    key = decrypt(existing.apiKey);
  }

  return testImageConnection({ baseUrl, apiKey: key, model });
}
