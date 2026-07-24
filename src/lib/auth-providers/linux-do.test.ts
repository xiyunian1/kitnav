import { describe, expect, it } from "vitest";
import LinuxDo, { normalizeLinuxDoIssuer } from "./linux-do";

describe("Linux.do OAuth provider", () => {
  it("normalizes issuer values to the canonical trailing-slash form", () => {
    expect(normalizeLinuxDoIssuer()).toBe("https://connect.linux.do/");
    expect(normalizeLinuxDoIssuer("https://connect.linux.do")).toBe(
      "https://connect.linux.do/",
    );
    expect(normalizeLinuxDoIssuer("  https://connect.linux.do///  ")).toBe(
      "https://connect.linux.do/",
    );
  });

  it("uses the normalized issuer in the provider configuration", () => {
    const previous = process.env.LINUX_DO_ISSUER;
    process.env.LINUX_DO_ISSUER = "https://connect.linux.do";
    try {
      const provider = LinuxDo({
        clientId: "client-id",
        clientSecret: "client-secret",
      });
      expect(provider.issuer).toBe("https://connect.linux.do/");
    } finally {
      if (previous === undefined) delete process.env.LINUX_DO_ISSUER;
      else process.env.LINUX_DO_ISSUER = previous;
    }
  });
});
