import { describe, expect, it } from "vitest";
import { boundedIntegerEnv, MAX_NODE_TIMER_MS } from "./runtime-config";

describe("boundedIntegerEnv", () => {
  it("accepts integers inside the configured bounds", () => {
    expect(
      boundedIntegerEnv("INTERVAL", 2_000, {
        min: 100,
        environment: { INTERVAL: "500" },
      }),
    ).toBe(500);
    expect(
      boundedIntegerEnv("INTERVAL", 2_000, {
        min: 100,
        environment: { INTERVAL: String(MAX_NODE_TIMER_MS) },
      }),
    ).toBe(MAX_NODE_TIMER_MS);
  });

  it("falls back for missing, fractional, out-of-range, or invalid values", () => {
    for (const value of [undefined, "", "1.5", "0", "-1", "invalid", "9999999999"]) {
      expect(
        boundedIntegerEnv("INTERVAL", 2_000, {
          min: 100,
          environment: { INTERVAL: value },
        }),
      ).toBe(2_000);
    }
  });

  it("rejects invalid fallback bounds", () => {
    expect(() =>
      boundedIntegerEnv("INTERVAL", 50, {
        min: 100,
        environment: {},
      }),
    ).toThrow("Invalid bounds");
  });
});
