import { resolveBillingMode } from "@/lib/providers";

export async function resolvePptAgentBillingMode(userId: string) {
  const providerMode = await resolveBillingMode(userId, "PPT");

  return {
    ...providerMode,
    // Generation is always handled by pi, but pi should use the same BYOK
    // decision as the user's PPT API configuration.
    useOwnKey: providerMode.useOwnKey,
  };
}
