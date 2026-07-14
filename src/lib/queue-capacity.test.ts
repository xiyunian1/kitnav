import { describe, expect, it } from "vitest";
import {
  getImageGlobalMaxPending,
  getPptGlobalMaxPending,
} from "./queue-capacity";

describe("global queue capacity configuration", () => {
  it("accepts configured values inside the supported bounds", () => {
    const environment = {
      IMAGE_GLOBAL_MAX_PENDING: "250",
      PPT_GLOBAL_MAX_PENDING: "75",
    };
    expect(getImageGlobalMaxPending(environment)).toBe(250);
    expect(getPptGlobalMaxPending(environment)).toBe(75);
  });

  it.each(["invalid", "0", "1.5", "10000000000"])(
    "falls back for invalid values (%s)",
    (value) => {
      const environment = {
        IMAGE_GLOBAL_MAX_PENDING: value,
        PPT_GLOBAL_MAX_PENDING: value,
      };
      expect(getImageGlobalMaxPending(environment)).toBe(100);
      expect(getPptGlobalMaxPending(environment)).toBe(30);
    },
  );
});
