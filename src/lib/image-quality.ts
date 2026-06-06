export const IMAGE_PROVIDER_QUALITIES = ["low", "medium", "high"] as const;
export type ImageProviderQuality = (typeof IMAGE_PROVIDER_QUALITIES)[number];

export const IMAGE_QUALITIES = ["standard", "hd", "ultra"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export const IMAGE_QUALITY_META: Record<
  ImageQuality,
  { label: string; providerQuality?: ImageProviderQuality; costMultiplier: number }
> = {
  standard: { label: "标准", costMultiplier: 1 },
  hd: { label: "高清", providerQuality: "medium", costMultiplier: 2 },
  ultra: { label: "超清", providerQuality: "high", costMultiplier: 3 },
};
