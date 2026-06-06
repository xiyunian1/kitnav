import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseModelList } from "@/lib/model-options";
import { getModelCreditCost, isModelEnabled, parseModelMeta } from "@/lib/model-meta";
import type { ModuleType } from "@prisma/client";
import type { ProviderCredentials } from "./types";
import { OpenAIImageProvider } from "./image-openai";

// 未配置任何可用的图片 API 时抛出。route 层捕获后返回 503 + 引导文案。
export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("图片服务尚未配置");
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderConfigInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigInvalidError";
  }
}

export interface ResolvedProvider {
  provider: OpenAIImageProvider;
  useOwnKey: boolean; // true=用户自带 key（不扣分）
  model: string;
  models: string[];
  creditCostOverride: number | null;
  source: "user" | "platform";
}

function resolveSelectedModel(defaultModel: string, storedModels: string | null, requestedModel?: string, modelMeta?: string | null) {
  const meta = parseModelMeta(modelMeta);
  const models = parseModelList(storedModels);
  const allowed = (models.length > 0 ? models : [defaultModel]).filter((model) => isModelEnabled(meta, model));
  if (allowed.length === 0) throw new Error("当前 API 配置没有启用的模型");
  if (requestedModel) {
    if (!allowed.includes(requestedModel)) {
      throw new Error("所选模型不在当前 API 配置中");
    }
    return { model: requestedModel, models: allowed, creditCostOverride: getModelCreditCost(meta, requestedModel) };
  }
  const model = allowed.includes(defaultModel) ? defaultModel : allowed[0];
  return { model, models: allowed, creditCostOverride: getModelCreditCost(meta, model) };
}

// 计费分流核心：决定本次图片生成走用户自带 key 还是平台上游。
// 优先级：用户已启用的配置 > 平台已启用的配置 > 抛错（不再 mock 兜底）。
export async function resolveImageProvider(
  userId: string,
  module: ModuleType = "IMAGE",
  requestedModel?: string
): Promise<ResolvedProvider> {
  // 1. 用户自带配置（已启用）→ 用用户 key，不扣分
  const userCfg = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module } },
  });
  if (userCfg?.enabled) {
    const selected = resolveSelectedModel(userCfg.model, userCfg.models, requestedModel);
    let apiKey: string;
    try {
      apiKey = decrypt(userCfg.apiKey);
    } catch {
      throw new ProviderConfigInvalidError("你的 API Key 无法解密，请在「API 设置」里重新保存一次");
    }
    const creds: ProviderCredentials = {
      baseUrl: userCfg.baseUrl,
      apiKey,
      model: selected.model,
    };
    return {
      provider: new OpenAIImageProvider(creds),
      useOwnKey: true,
      model: selected.model,
      models: selected.models,
      creditCostOverride: null,
      source: "user",
    };
  }

  // 2. 平台上游配置（已启用）→ 用平台 key，扣积分
  const platformCfg = await prisma.providerConfig.findUnique({
    where: { module },
  });
  if (platformCfg?.enabled) {
    const selected = resolveSelectedModel(platformCfg.model, platformCfg.models, requestedModel, platformCfg.modelMeta);
    let apiKey: string;
    try {
      apiKey = decrypt(platformCfg.apiKey);
    } catch {
      throw new ProviderConfigInvalidError("平台 API Key 无法解密，请管理员在后台重新保存一次 API Key");
    }
    const creds: ProviderCredentials = {
      baseUrl: platformCfg.baseUrl,
      apiKey,
      model: selected.model,
    };
    return {
      provider: new OpenAIImageProvider(creds),
      useOwnKey: false,
      model: selected.model,
      models: selected.models,
      creditCostOverride: selected.creditCostOverride,
      source: "platform",
    };
  }

  // 3. 都没配 → 抛错引导去配置
  throw new ProviderNotConfiguredError();
}

// 仅判定本次生成是否走用户自带 key（供页面预先显示计费提示，不构造 provider）。
export async function resolveBillingMode(
  userId: string,
  module: ModuleType = "IMAGE"
): Promise<{ useOwnKey: boolean; source: "user" | "platform" | "none"; models: string[]; defaultModel: string }> {
  const userCfg = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module } },
    select: { enabled: true, model: true, models: true },
  });
  if (userCfg?.enabled) {
    return {
      useOwnKey: true,
      source: "user",
      defaultModel: userCfg.model,
      models: parseModelList(userCfg.models).length ? parseModelList(userCfg.models) : [userCfg.model],
    };
  }

  const platformCfg = await prisma.providerConfig.findUnique({
    where: { module },
    select: { enabled: true, model: true, models: true, modelMeta: true },
  });
  if (platformCfg?.enabled) {
    const meta = parseModelMeta(platformCfg.modelMeta);
    const configuredModels = parseModelList(platformCfg.models).length
      ? parseModelList(platformCfg.models)
      : [platformCfg.model];
    const models = configuredModels.filter((model) => isModelEnabled(meta, model));
    const defaultModel = models.includes(platformCfg.model) ? platformCfg.model : models[0] ?? "";

    return {
      useOwnKey: false,
      source: "platform",
      defaultModel,
      models,
    };
  }

  return { useOwnKey: false, source: "none", models: [], defaultModel: "" };
}
