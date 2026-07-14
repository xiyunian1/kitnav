import { resolveBillingMode } from "@/lib/providers";
import type { ModelSource } from "@/lib/module-model-options";

export const DEFAULT_PPT_CREDITS_PER_SLIDE = 10;

export function getPptCreditsPerSlide(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configured = environment.PPT_CREDITS_PER_SLIDE?.trim();
  if (!configured) return DEFAULT_PPT_CREDITS_PER_SLIDE;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_PPT_CREDITS_PER_SLIDE;
}

export async function resolvePptAgentBillingMode(
  userId: string,
  selection?: { model?: string; source?: ModelSource },
) {
  const providerMode = await resolveBillingMode(
    userId,
    "PPT",
    selection?.model,
    selection?.source,
  );

  return {
    ...providerMode,
    // Pi uses the explicitly selected source; user models are BYOK and platform
    // models are charged even when the user's own PPT API is enabled.
    useOwnKey: providerMode.useOwnKey,
  };
}
