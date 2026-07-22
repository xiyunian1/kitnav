import { describe, expect, it } from "vitest";
import {
  buildPptDesignPreferenceInstruction,
  getPptColorPreferenceOption,
  getPptTypographyPreferenceOption,
} from "./design-options";

describe("PPT design preferences", () => {
  it("uses stable automatic defaults", () => {
    expect(getPptColorPreferenceOption().id).toBe("auto");
    expect(getPptTypographyPreferenceOption().id).toBe("auto");
  });

  it("builds explicit color and typography contracts", () => {
    const instruction = buildPptDesignPreferenceInstruction({
      colorPreference: "monochrome",
      typographyPreference: "editorial",
    });

    expect(instruction).toContain("配色偏好（黑白单色）");
    expect(instruction).toContain("字体偏好（编辑排版）");
    expect(instruction).toContain("spec_lock.md");
  });

  it("keeps recommendation prompts out of the full contract phase", () => {
    const instruction = buildPptDesignPreferenceInstruction({
      phase: "recommendation",
    });

    expect(instruction).toContain("只把色板与字体组合写入候选 JSON");
    expect(instruction).not.toContain("spec_lock.md");
  });

  it("falls back for unknown persisted values", () => {
    expect(getPptColorPreferenceOption("unknown").id).toBe("auto");
    expect(getPptTypographyPreferenceOption("unknown").id).toBe("auto");
  });
});
