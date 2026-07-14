import { fetchPublicApi } from "@/lib/safe-fetch";
import type { ProviderNetworkPolicy } from "./types";

export function fetchProviderEndpoint(
  url: string,
  init: RequestInit,
  networkPolicy: ProviderNetworkPolicy = "public",
) {
  return networkPolicy === "trusted"
    ? fetch(url, init)
    : fetchPublicApi(url, init);
}
