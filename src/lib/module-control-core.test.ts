import { describe, expect, it } from "vitest";
import {
  getModuleControlDefinitionByModuleType,
  isModuleUsable,
  isModuleVisible,
  normalizeStatus,
} from "@/lib/module-control-core";

describe("module control core", () => {
  it("maps worker module types without loading web-only metadata", () => {
    expect(getModuleControlDefinitionByModuleType("IMAGE")?.key).toBe("image");
    expect(getModuleControlDefinitionByModuleType("PPT")?.key).toBe("ppt");
  });

  it("normalizes unknown persisted states to the configured fallback", () => {
    expect(normalizeStatus("closed", "open")).toBe("closed");
    expect(normalizeStatus("invalid", "coming-soon")).toBe("coming-soon");
  });

  it("keeps visibility and usability rules aligned", () => {
    expect(isModuleVisible({ status: "hidden" }, false)).toBe(false);
    expect(isModuleVisible({ status: "hidden" }, true)).toBe(true);
    expect(isModuleUsable({ status: "admin" }, false)).toBe(false);
    expect(isModuleUsable({ status: "admin" }, true)).toBe(true);
    expect(isModuleUsable({ status: "closed" }, true)).toBe(false);
  });
});
