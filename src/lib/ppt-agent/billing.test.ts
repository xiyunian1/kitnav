import { describe, expect, it } from "vitest";
import {
  DEFAULT_PPT_CREDITS_PER_SLIDE,
  getPptCreditsPerSlide,
} from "./billing";

describe("getPptCreditsPerSlide", () => {
  it("accepts non-negative integer prices", () => {
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "12" })).toBe(12);
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "0" })).toBe(0);
  });

  it("falls back for invalid prices", () => {
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "-1" })).toBe(
      DEFAULT_PPT_CREDITS_PER_SLIDE,
    );
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "1.5" })).toBe(
      DEFAULT_PPT_CREDITS_PER_SLIDE,
    );
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "invalid" })).toBe(
      DEFAULT_PPT_CREDITS_PER_SLIDE,
    );
    expect(getPptCreditsPerSlide({ PPT_CREDITS_PER_SLIDE: "" })).toBe(
      DEFAULT_PPT_CREDITS_PER_SLIDE,
    );
  });
});
