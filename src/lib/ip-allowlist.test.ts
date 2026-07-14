import { describe, expect, it } from "vitest";
import { isIpAllowed, isRequestIpAllowed } from "./ip-allowlist";

describe("isIpAllowed", () => {
  it("allows every valid request when no allowlist is configured", () => {
    expect(isIpAllowed("203.0.113.8", "")).toBe(true);
  });

  it("matches exact addresses and CIDR ranges", () => {
    const configured = "203.0.113.8, 198.51.100.0/24 2001:db8::/32";
    expect(isIpAllowed("203.0.113.8", configured)).toBe(true);
    expect(isIpAllowed("198.51.100.42", configured)).toBe(true);
    expect(isIpAllowed("2001:db8::42", configured)).toBe(true);
    expect(isIpAllowed("192.0.2.1", configured)).toBe(false);
  });

  it("rejects invalid allowlist configuration", () => {
    expect(() => isIpAllowed("203.0.113.8", "not-an-ip")).toThrow(
      "无效地址",
    );
    expect(() => isIpAllowed("203.0.113.8", "203.0.113.0/99")).toThrow(
      "CIDR",
    );
  });
});

describe("isRequestIpAllowed", () => {
  it("uses the proxy-provided client address", () => {
    const request = new Request("https://example.test/callback", {
      headers: { "x-forwarded-for": "198.51.100.12, 172.18.0.2" },
    });
    expect(isRequestIpAllowed(request, "198.51.100.0/24")).toBe(true);
  });
});
