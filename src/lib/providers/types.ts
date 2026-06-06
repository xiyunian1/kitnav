import type { ImageProviderQuality } from "@/lib/image-quality";

export interface ImageGenerationParams {
  prompt: string;
  size?: string;
  quality?: ImageProviderQuality;
  count?: number;
}

export interface ImageEditParams {
  prompt: string;
  image: Blob;
  imageFilename?: string;
  size?: string;
  quality?: ImageProviderQuality;
  count?: number;
}

export interface GenerationResult {
  urls: string[];
}

export class UpstreamImageError extends Error {
  constructor(
    message: string,
    public status?: number,
    public elapsedMs?: number
  ) {
    super(message);
    this.name = "UpstreamImageError";
  }
}

export interface ImageProvider {
  readonly name: string;
  generate(params: ImageGenerationParams): Promise<GenerationResult>;
  edit?(params: ImageEditParams): Promise<GenerationResult>;
}

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const MAX_IMAGE_COUNT = 10;

export const ASPECT_RATIOS = ["1:1", "16:9", "4:3", "3:4", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const RATIO_TO_PIXEL: Record<AspectRatio, ImageSize> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "4:3": "1536x1024",
  "9:16": "1024x1536",
  "3:4": "1024x1536",
};
