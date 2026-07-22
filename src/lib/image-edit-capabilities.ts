export const MAX_REFERENCE_IMAGE_COUNT = 16;
export const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_TOTAL_BYTES = 30 * 1024 * 1024;

export const REFERENCE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

const REFERENCE_IMAGE_MIME_TYPE_SET = new Set<string>(REFERENCE_IMAGE_MIME_TYPES);

const MULTI_IMAGE_MODEL_ALIASES = new Set([
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "chatgpt-image-latest",
]);

const VERSIONED_MULTI_IMAGE_MODEL_FAMILIES = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
] as const;

export function supportsNativeMultiImageEdit(model: string) {
  const normalized = model.trim().toLowerCase();
  if (MULTI_IMAGE_MODEL_ALIASES.has(normalized)) return true;

  return VERSIONED_MULTI_IMAGE_MODEL_FAMILIES.some((family) => {
    if (!normalized.startsWith(`${family}-`)) return false;
    const suffix = normalized.slice(family.length + 1);
    return /^\d{4}-\d{2}-\d{2}$/.test(suffix);
  });
}

export function isSupportedReferenceImageType(mimeType: string) {
  return REFERENCE_IMAGE_MIME_TYPE_SET.has(mimeType.toLowerCase());
}
