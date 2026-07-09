import { describe, expect, it } from "vitest";
import {
  buildAutoCreativeInstruction,
  buildPptStyleInstruction,
  getPptStylePreset,
} from "./styles";

describe("PPT auto creative style", () => {
  it("uses auto creative as the default preset", () => {
    expect(getPptStylePreset().id).toBe("auto");
    expect(getPptStylePreset("unknown").id).toBe("auto");
  });

  it("is deterministic for the same project", () => {
    const first = buildAutoCreativeInstruction({
      projectId: "project-repeatable",
      sourceText: "Agent 学习路线",
    });
    const second = buildAutoCreativeInstruction({
      projectId: "project-repeatable",
      sourceText: "Agent 学习路线",
    });

    expect(first).toBe(second);
    expect(first).toContain("候选视觉方向：");
    expect(first).toContain("最终选择：");
    expect(first).toContain("当前输入较短");
    expect(first).not.toContain("#1565C0");
  });

  it("uses a generated direction when style is omitted", () => {
    const instruction = buildPptStyleInstruction({
      projectId: "project-without-style",
      sourceText: "年度规划",
      hasTemplate: false,
    });

    expect(instruction).toContain("风格名称：自动创意");
    expect(instruction).toContain("候选视觉方向：");
  });

  it("varies the selected visual direction across project ids", () => {
    const outputs = ["project-a", "project-b", "project-c", "project-d"].map(
      (projectId) => buildAutoCreativeInstruction({ projectId }),
    );
    const selections = outputs.map(
      (output) => output.match(/最终选择：(.+)/)?.[1],
    );

    expect(new Set(selections).size).toBeGreaterThan(1);
  });

  it("does not inject a generated direction when a template is present", () => {
    const instruction = buildPptStyleInstruction({
      style: "auto",
      projectId: "project-with-template",
      hasTemplate: true,
    });

    expect(instruction).toContain("优先遵循上传模板");
    expect(instruction).not.toContain("候选视觉方向：");
  });

  it("keeps an explicitly selected preset unchanged", () => {
    const instruction = buildPptStyleInstruction({
      style: "general",
      projectId: "project-general",
      hasTemplate: false,
    });

    expect(instruction).toContain("风格名称：通用演示");
    expect(instruction).toContain("白底或浅色背景");
    expect(instruction).not.toContain("候选视觉方向：");
  });
});
