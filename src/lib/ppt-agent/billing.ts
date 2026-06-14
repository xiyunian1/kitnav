import { resolveBillingMode } from "@/lib/providers";

export async function resolvePptAgentBillingMode(userId: string) {
  const providerMode = await resolveBillingMode(userId, "PPT");
  const useCliAgent = process.env.PPT_AGENT_MODE === "cli";

  return {
    ...providerMode,
    // CLI mode uses the server-side coding agent credentials. API mode uses
    // the saved PPT provider config, so BYOK can be honored there.
    useOwnKey: useCliAgent ? false : providerMode.useOwnKey,
  };
}
