import { resolveBillingMode } from "@/lib/providers";
import type { ModelSource } from "@/lib/module-model-options";

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
