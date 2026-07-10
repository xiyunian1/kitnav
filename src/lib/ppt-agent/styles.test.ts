import { describe, expect, it } from "vitest";
import {
  buildAutoCreativeInstruction,
  buildPptStyleInstruction,
  getPptMasterStyleContract,
  getPptStylePreset,
  PPT_MASTER_MODE_VALUES,
  PPT_MASTER_VISUAL_STYLE_VALUES,
  PPT_STYLE_PRESETS,
} from "./styles";

describe("PPT auto creative style", () => {
  it("uses auto creative as the default preset", () => {
    expect(getPptStylePreset().id).toBe("auto");
    expect(getPptStylePreset("unknown").id).toBe("auto");
  });

  it("uses the official catalogs for automatic selection", () => {
    const first = buildAutoCreativeInstruction({
      projectId: "project-repeatable",
      sourceText: "Agent 学习路线",
    });
    const second = buildAutoCreativeInstruction({
      projectId: "project-repeatable",
      sourceText: "Agent 学习路线",
    });

    expect(first).toBe(second);
    expect(first).toContain("references/modes/_index.md");
    expect(first).toContain("references/visual-styles/_index.md");
    expect(first).toContain("当前输入较短");
    expect(first).not.toMatch(/#[0-9A-F]{6}/i);
  });

  it("uses a generated direction when style is omitted", () => {
    const instruction = buildPptStyleInstruction({
      projectId: "project-without-style",
      sourceText: "年度规划",
      hasTemplate: false,
    });

    expect(instruction).toContain("风格名称：自动创意");
    expect(instruction).toContain("官方模式与视觉风格目录");
  });

  it("maps every preset to official catalog ids or auto", () => {
    for (const preset of PPT_STYLE_PRESETS) {
      expect(
        preset.mode === "auto" || PPT_MASTER_MODE_VALUES.includes(preset.mode),
      ).toBe(true);
      expect(
        preset.visualStyle === "auto" ||
          preset.visualStyle === "custom" ||
          PPT_MASTER_VISUAL_STYLE_VALUES.includes(preset.visualStyle),
      ).toBe(true);
    }
  });

  it("does not inject a generated direction when a template is present", () => {
    const instruction = buildPptStyleInstruction({
      style: "auto",
      projectId: "project-with-template",
      hasTemplate: true,
    });

    expect(instruction).toContain("优先遵循上传模板");
    expect(instruction).toContain("PPT Master 官方设计契约");
  });

  it("keeps an explicitly selected preset unchanged", () => {
    const instruction = buildPptStyleInstruction({
      style: "general",
      projectId: "project-general",
      hasTemplate: false,
    });

    expect(instruction).toContain("风格名称：通用演示");
    expect(instruction).toContain("白底或浅色背景");
    expect(instruction).toContain("mode: briefing");
    expect(instruction).toContain("visual_style: soft-rounded");
  });

  it("preserves custom visual intent in the official escape hatch", () => {
    const contract = getPptMasterStyleContract(
      "custom",
      "使用窄边框、强留白和纸张纹理",
    );

    expect(contract).toEqual({
      mode: "auto",
      visualStyle: "custom",
      visualStyleBehavior: "使用窄边框、强留白和纸张纹理",
    });
  });
});
