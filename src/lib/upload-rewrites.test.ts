import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("legacy upload rewrites", () => {
  it("allows the documented feedback screenshot payload", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("16mb");
  });

  it("authorizes known legacy files and blocks other public runtime data", async () => {
    expect(nextConfig.rewrites).toBeTypeOf("function");
    const rewrites = await nextConfig.rewrites!();
    expect(Array.isArray(rewrites)).toBe(false);
    if (Array.isArray(rewrites)) throw new Error("Expected phased rewrites");

    expect(rewrites.beforeFiles).toEqual(
      expect.arrayContaining([
        {
          source: "/uploads/materials/:path*",
          destination: "/api/files/materials/:path*",
        },
        {
          source: "/uploads/feedback/:path*",
          destination: "/api/files/feedback/:path*",
        },
        {
          source: "/projects/:path*",
          destination: "/api/files/private-static",
        },
        {
          source: "/uploads/:path*",
          destination: "/api/files/private-static",
        },
      ]),
    );
  });
});
