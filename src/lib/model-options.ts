export function parseModelList(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return normalizeModelList(parsed.map(String));
    }
  } catch {
    // fall through
  }
  return normalizeModelList(value.split(/[,\s，、]+/));
}

export function normalizeModelList(models: string[], fallback?: string): string[] {
  const list = models.map((model) => model.trim()).filter(Boolean);
  if (fallback?.trim()) list.unshift(fallback.trim());
  return Array.from(new Set(list)).slice(0, 50);
}

export function modelListToJson(models: string[], fallback?: string): string {
  return JSON.stringify(normalizeModelList(models, fallback));
}
