import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publicFetch: vi.fn(),
}));

vi.mock("@/lib/safe-fetch", () => ({
  fetchPublicApi: mocks.publicFetch,
}));

import { fetchProviderEndpoint } from "./network";

describe("provider network policy", () => {
  const trustedFetch = vi.fn();

  beforeEach(() => {
    mocks.publicFetch.mockReset();
    trustedFetch.mockReset();
    vi.stubGlobal("fetch", trustedFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the public-only transport by default", async () => {
    mocks.publicFetch.mockResolvedValue(new Response("ok"));

    await fetchProviderEndpoint("https://api.example.com/v1", {
      method: "POST",
    });

    expect(mocks.publicFetch).toHaveBeenCalledOnce();
    expect(trustedFetch).not.toHaveBeenCalled();
  });

  it("allows trusted platform providers to use the normal transport", async () => {
    trustedFetch.mockResolvedValue(new Response("ok"));

    await fetchProviderEndpoint(
      "http://platform-api:8080/v1",
      { method: "POST" },
      "trusted",
    );

    expect(trustedFetch).toHaveBeenCalledOnce();
    expect(mocks.publicFetch).not.toHaveBeenCalled();
  });
});
