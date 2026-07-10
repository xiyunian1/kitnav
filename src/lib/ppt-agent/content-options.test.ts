import { describe, expect, it } from "vitest";
import {
  buildPptContentInstruction,
  getPptAudienceOption,
  getPptDeliveryPurpose,
  getPptTextVolumeOption,
  getPptToneOption,
} from "./content-options";

describe("PPT content options", () => {
  it("uses stable defaults for legacy projects", () => {
    expect(getPptTextVolumeOption().label).toBe("适中");
    expect(getPptAudienceOption().label).toBe("通用受众");
    expect(getPptToneOption().label).toBe("自然");
  });

  it("builds concrete instructions for the selected preferences", () => {
    const instruction = buildPptContentInstruction({
      textVolume: "detailed",
      audience: "executives",
      tone: "analytical",
    });

    expect(instruction).toContain("文字量（详细）");
    expect(instruction).toContain("面向对象（管理层）");
    expect(instruction).toContain("表达语气（分析）");
    expect(instruction).toContain("不得用过小字号容纳文字");
  });

  it("falls back when persisted values are unknown", () => {
    expect(getPptTextVolumeOption("unknown").id).toBe("balanced");
    expect(getPptAudienceOption("unknown").id).toBe("general");
    expect(getPptToneOption("unknown").id).toBe("natural");
  });

  it("maps text volume to the official delivery purpose", () => {
    expect(getPptDeliveryPurpose("concise")).toBe("presentation");
    expect(getPptDeliveryPurpose("balanced")).toBe("balanced");
    expect(getPptDeliveryPurpose("detailed")).toBe("text");
    expect(getPptDeliveryPurpose("unknown")).toBe("balanced");
  });
});
