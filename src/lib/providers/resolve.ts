import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseModelList } from "@/lib/model-options";
import { getModelCreditCost, isModelEnabled, parseModelMeta } from "@/lib/model-meta";
import {
  buildModuleModelOptions,
  type ModelSource,
  type ModuleModelOption,
} from "@/lib/module-model-options";
import type { ModuleType } from "@prisma/client";
import type { ProviderCredentials } from "./types";
import { OpenAIImageProvider } from "./image-openai";
import { OpenAITextProvider } from "./text-openai";
import { parsePptModelOptions } from "@/lib/ppt-agent/model-options";

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

export interface ResolvedTextProvider {
  provider: OpenAITextProvider;
  useOwnKey: boolean;
  model: string;
  models: string[];
  source: "user" | "platform";
}

function resolveSelectedModel(defaultModel: string, storedModels: string | null, requestedModel?: string, modelMeta?: string | null) {
  const meta = parseModelMeta(modelMeta);
  const models = parseModelList(storedModels);
  const allowed = (models.length > 0 ? models : [defaultModel]).filter((model) => isModelEnabled(meta, model));
  if (allowed.length === 0) {
    throw new ProviderConfigInvalidError("当前 API 配置没有启用的模型");
  }
  if (requestedModel) {
    if (!allowed.includes(requestedModel)) {
      throw new ProviderConfigInvalidError("所选模型未保存或已停用");
    }
    return { model: requestedModel, models: allowed, creditCostOverride: getModelCreditCost(meta, requestedModel) };
  }
  const model = allowed.includes(defaultModel) ? defaultModel : allowed[0];
  return { model, models: allowed, creditCostOverride: getModelCreditCost(meta, model) };
}

export async function getModuleModelOptions(
  userId: string,
  module: ModuleType,
): Promise<ModuleModelOption[]> {
  const [userCfg, platformCfg] = await Promise.all([
    prisma.userApiConfig.findUnique({
      where: { userId_module: { userId, module } },
      select: { enabled: true, model: true, models: true, modelOptions: true },
    }),
    prisma.providerConfig.findUnique({
      where: { module },
      select: { enabled: true, model: true, models: true, modelMeta: true, modelOptions: true },
    }),
  ]);

  return buildModuleModelOptions([
    ...(userCfg
      ? [{
          source: "user" as const,
          ...userCfg,
          visionModels:
            module === "PPT"
              ? parsePptModelOptions(userCfg.modelOptions).visionModels
              : [],
        }]
      : []),
    ...(platformCfg
      ? [{
          source: "platform" as const,
          enabled: platformCfg.enabled,
          model: platformCfg.model,
          models: platformCfg.models,
          modelMeta: parseModelMeta(platformCfg.modelMeta),
          visionModels:
            module === "PPT"
              ? parsePptModelOptions(platformCfg.modelOptions).visionModels
              : [],
        }]
      : []),
  ]);
}

// 计费分流核心：显式来源优先；旧请求未传来源时继续兼容用户配置优先级。
export async function resolveImageProvider(
  userId: string,
  module: ModuleType = "IMAGE",
  requestedModel?: string,
  requestedSource?: ModelSource,
): Promise<ResolvedProvider> {
  // 1. 用户自带配置（已启用）→ 用用户 key，不扣分
  const userCfg = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module } },
  });
  if (requestedSource !== "platform" && userCfg?.enabled) {
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
  if (requestedSource === "user") {
    throw new ProviderConfigInvalidError("你的图片 API 配置未启用或不可用");
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
  if (requestedSource === "platform") {
    throw new ProviderConfigInvalidError("平台图片 API 配置未启用或不可用");
  }

  // 3. 都没配 → 抛错引导去配置
  throw new ProviderNotConfiguredError();
}

export async function resolveTextProvider(
  userId: string,
  module: ModuleType,
  requestedModel?: string,
  requestedSource?: ModelSource,
): Promise<ResolvedTextProvider> {
  const userCfg = await prisma.userApiConfig.findUnique({
    where: { userId_module: { userId, module } },
  });
  if (requestedSource !== "platform" && userCfg?.enabled) {
    const selected = resolveSelectedModel(userCfg.model, userCfg.models, requestedModel);
    let apiKey: string;
    try {
      apiKey = decrypt(userCfg.apiKey);
    } catch {
      throw new ProviderConfigInvalidError("你的 API Key 无法解密，请在「API 设置」里重新保存一次");
    }
    return {
      provider: new OpenAITextProvider({
        baseUrl: userCfg.baseUrl,
        apiKey,
        model: selected.model,
      }),
      useOwnKey: true,
      model: selected.model,
      models: selected.models,
      source: "user",
    };
  }
  if (requestedSource === "user") {
    throw new ProviderConfigInvalidError("你的 API 配置未启用或不可用");
  }

  const platformCfg = await prisma.providerConfig.findUnique({
    where: { module },
  });
  if (platformCfg?.enabled) {
    const selected = resolveSelectedModel(
      platformCfg.model,
      platformCfg.models,
      requestedModel,
      platformCfg.modelMeta
    );
    let apiKey: string;
    try {
      apiKey = decrypt(platformCfg.apiKey);
    } catch {
      throw new ProviderConfigInvalidError("平台 API Key 无法解密，请管理员在后台重新保存一次 API Key");
    }
    return {
      provider: new OpenAITextProvider({
        baseUrl: platformCfg.baseUrl,
        apiKey,
        model: selected.model,
      }),
      useOwnKey: false,
      model: selected.model,
      models: selected.models,
      source: "platform",
    };
  }
  if (requestedSource === "platform") {
    throw new ProviderConfigInvalidError("平台 API 配置未启用或不可用");
  }

  throw new ProviderNotConfiguredError();
}

// 校验模块所选模型并判定是否走用户自带 key，不构造 provider。
export async function resolveBillingMode(
  userId: string,
  module: ModuleType = "IMAGE",
  requestedModel?: string,
  requestedSource?: ModelSource,
): Promise<{ useOwnKey: boolean; source: "user" | "platform" | "none"; models: string[]; defaultModel: string; supportsVision: boolean }> {
  const options = await getModuleModelOptions(userId, module);
  if (options.length === 0) {
    return { useOwnKey: false, source: "none", models: [], defaultModel: "", supportsVision: false };
  }

  const selected = requestedModel || requestedSource
    ? options.find(
        (option) =>
          (!requestedModel || option.model === requestedModel) &&
          (!requestedSource || option.source === requestedSource),
      )
    : options[0];
  if (!selected) {
    throw new ProviderConfigInvalidError("所选模型未保存、已停用或对应 API 配置不可用");
  }

  return {
    useOwnKey: selected.source === "user",
    source: selected.source,
    defaultModel: selected.model,
    supportsVision: selected.supportsVision,
    models: options
      .filter((option) => option.source === selected.source)
      .map((option) => option.model),
  };
}
