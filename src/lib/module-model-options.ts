import { parseModelList } from "@/lib/model-options";
import {
  getModelCreditCost,
  isModelEnabled,
  type ModelMetaMap,
} from "@/lib/model-meta";

export const MODEL_SOURCES = ["user", "platform"] as const;

export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface ModuleModelOption {
  value: string;
  model: string;
  source: ModelSource;
  sourceLabel: "我的 API" | "平台";
  creditCost: number | null;
  supportsVision: boolean;
  note?: string;
}

export interface StoredModuleModelConfig {
  source: ModelSource;
  enabled: boolean;
  model: string;
  models?: string | null;
  modelMeta?: ModelMetaMap;
  visionModels?: string[];
}

export function moduleModelValue(source: ModelSource, model: string) {
  return `${source}:${model}`;
}

export function buildModuleModelOptions(
  configs: StoredModuleModelConfig[],
): ModuleModelOption[] {
  return configs.flatMap((config) => {
    if (!config.enabled) return [];

    const configuredModels = parseModelList(config.models);
    const models = configuredModels.length > 0 ? configuredModels : [config.model];
    const meta = config.modelMeta ?? {};

    return models
      .filter((model) => config.source === "user" || isModelEnabled(meta, model))
      .map((model) => ({
        value: moduleModelValue(config.source, model),
        model,
        source: config.source,
        sourceLabel: config.source === "user" ? "我的 API" as const : "平台" as const,
        creditCost:
          config.source === "platform" ? getModelCreditCost(meta, model) : null,
        supportsVision: config.visionModels?.includes(model) ?? false,
        note: config.source === "platform" ? meta[model]?.note : undefined,
      }));
  });
}

export function findModuleModelOption(
  options: ModuleModelOption[],
  model?: string,
  source?: ModelSource,
) {
  if (!model) return undefined;
  return options.find(
    (option) => option.model === model && (!source || option.source === source),
  );
}
