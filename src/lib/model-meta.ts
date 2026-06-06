export type ModelMeta = {
  enabled?: boolean;
  creditCost?: number;
  note?: string;
};

export type ModelMetaMap = Record<string, ModelMeta>;

export function parseModelMeta(value?: string | null): ModelMetaMap {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ModelMetaMap)
      : {};
  } catch {
    return {};
  }
}

export function modelMetaToJson(value: ModelMetaMap) {
  return JSON.stringify(value);
}

export function isModelEnabled(meta: ModelMetaMap, model: string) {
  return meta[model]?.enabled !== false;
}

export function getModelCreditCost(meta: ModelMetaMap, model: string) {
  const cost = meta[model]?.creditCost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Math.floor(cost) : null;
}
