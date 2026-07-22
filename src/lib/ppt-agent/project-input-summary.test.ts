import { describe, expect, it } from "vitest";
import { summarizePptProjectInput } from "./project-input-summary";
import { formatPptProjectInputSummary } from "./project-input-summary-format";

const uploadPrefix =
  "1784684000000-123e4567-e89b-12d3-a456-426614174000-";

describe("PPT project input summary", () => {
  it("returns user input and readable settings without internal paths", () => {
    const summary = summarizePptProjectInput({
      params: JSON.stringify({
        prompt: "为管理层制作季度经营复盘",
        sourceFileUrls: [`/srv/private/user-1/${uploadPrefix}report.pdf`],
        sourceFileNames: ["季度经营报告 终稿.pdf"],
        templateFileUrls: [`/srv/private/user-1/${uploadPrefix}brand.pptx`],
        templateFileNames: ["公司品牌模板.pptx"],
        slideCount: 12,
        aspectRatio: "16:9",
        style: "custom",
        styleLabel: "自定义风格",
        stylePrompt: "白底，使用品牌红作为强调色",
        model: "gpt-5.6-sol",
        modelSource: "user",
        imageModel: "gpt-image-1",
        imageModelSource: "platform",
        textVolume: "concise",
        audience: "executives",
        tone: "professional",
        colorPreference: "light",
        typographyPreference: "modern",
        visualReview: true,
        confirmDesign: false,
        planningConfirmed: true,
        textCreditsCost: 120,
      }),
    });

    expect(summary).toEqual({
      textSections: [
        { label: "主题与要求", value: "为管理层制作季度经营复盘" },
        { label: "自定义视觉方向", value: "白底，使用品牌红作为强调色" },
      ],
      sourceFiles: ["季度经营报告 终稿.pdf"],
      templateFiles: ["公司品牌模板.pptx"],
      settings: [
        { label: "页数", value: "12 页" },
        { label: "页面比例", value: "16:9" },
        { label: "文案模型", value: "gpt-5.6-sol · 我的 API" },
        { label: "图片模型", value: "gpt-image-1 · 平台" },
        { label: "视觉风格", value: "按上传模板" },
        { label: "文字量", value: "精简" },
        { label: "面向对象", value: "管理层" },
        { label: "表达语气", value: "专业" },
        { label: "配色", value: "明亮清晰" },
        { label: "字体", value: "现代无衬线" },
        { label: "语言", value: "简体中文" },
        { label: "视觉复核", value: "开启" },
        { label: "生成前预览并调整方案", value: "关闭" },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain("/srv/private");
    expect(JSON.stringify(summary)).not.toContain("textCreditsCost");
    expect(JSON.stringify(summary)).not.toContain("planningConfirmed");

    const copied = formatPptProjectInputSummary(summary!);
    expect(copied).toContain("主题与要求\n为管理层制作季度经营复盘");
    expect(copied).toContain("上传资料\n季度经营报告 终稿.pdf");
    expect(copied).toContain("文案模型：gpt-5.6-sol · 我的 API");
  });

  it("recovers safe filenames for existing projects", () => {
    const summary = summarizePptProjectInput({
      params: JSON.stringify({
        prompt: "旧项目",
        sourceFileUrls: [
          `/app/data/ppt-uploads/user-1/${uploadPrefix}research%20notes.pdf`,
          `/app/data/ppt-uploads/user-1/${uploadPrefix}unsafe%2Fname.docx`,
        ],
        templateFileUrls: [
          `/app/data/ppt-uploads/user-1/${uploadPrefix}official.pptx`,
        ],
        style: "auto",
        styleLabel: "自动创意",
        stylePrompt: "内部风格提示不应展示",
      }),
    });

    expect(summary?.sourceFiles).toEqual([
      "research notes.pdf",
      "unsafe_name.docx",
    ]);
    expect(summary?.templateFiles).toEqual(["official.pptx"]);
    expect(summary?.textSections).toEqual([
      { label: "主题与要求", value: "旧项目" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("内部风格提示不应展示");
    expect(JSON.stringify(summary)).not.toContain("ppt-uploads");
  });

  it("falls back to legacy project columns when params are invalid", () => {
    const summary = summarizePptProjectInput({
      params: "not-json",
      topic: "旧版培训主题",
      sourceText: "补充讲义内容",
      sourceFileUrl: `C:\\private\\${uploadPrefix}course.docx`,
      slideCount: 8,
      aspectRatio: "4:3",
      style: "education",
      model: "legacy-model",
      audience: "students",
      tone: "educational",
      language: "简体中文",
    });

    expect(summary?.textSections).toEqual([
      { label: "主题", value: "旧版培训主题" },
      { label: "输入内容", value: "补充讲义内容" },
    ]);
    expect(summary?.sourceFiles).toEqual(["course.docx"]);
    expect(summary?.settings).toEqual([
      { label: "页数", value: "8 页" },
      { label: "页面比例", value: "4:3" },
      { label: "文案模型", value: "legacy-model" },
      { label: "视觉风格", value: "课程培训" },
      { label: "面向对象", value: "学生与学员" },
      { label: "表达语气", value: "教学" },
      { label: "语言", value: "简体中文" },
    ]);
  });

  it("returns null when no reusable input exists", () => {
    expect(summarizePptProjectInput({ params: "[]" })).toBeNull();
  });
});
