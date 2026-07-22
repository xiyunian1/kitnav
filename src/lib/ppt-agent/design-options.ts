export const PPT_COLOR_PREFERENCE_VALUES = [
  "auto",
  "light",
  "dark",
  "vivid",
  "monochrome",
] as const;

export const PPT_TYPOGRAPHY_PREFERENCE_VALUES = [
  "auto",
  "modern",
  "editorial",
  "friendly",
  "technical",
] as const;

export type PptColorPreference =
  (typeof PPT_COLOR_PREFERENCE_VALUES)[number];
export type PptTypographyPreference =
  (typeof PPT_TYPOGRAPHY_PREFERENCE_VALUES)[number];

interface DesignOption<T extends string> {
  id: T;
  label: string;
  prompt: string;
}

export const PPT_COLOR_PREFERENCE_OPTIONS: readonly DesignOption<PptColorPreference>[] = [
  {
    id: "auto",
    label: "自动配色",
    prompt:
      "根据主题、受众和视觉风格形成至少 3 个真实候选色板，再选择最合适的一组；不得无条件回退到通用科技蓝。",
  },
  {
    id: "light",
    label: "明亮清晰",
    prompt:
      "使用明亮中性背景和高对比深色正文，以一组主色和一组强调色建立层级，避免低对比粉彩文字。",
  },
  {
    id: "dark",
    label: "深色高对比",
    prompt:
      "使用深色背景与高对比浅色正文，强调色只用于焦点、数据和导航，避免大面积发光装饰影响阅读。",
  },
  {
    id: "vivid",
    label: "鲜明活力",
    prompt:
      "使用鲜明但受控的多色系统，不超过 3 组功能色；颜色必须承担分类或叙事作用，不能形成无意义彩虹卡片。",
  },
  {
    id: "monochrome",
    label: "黑白单色",
    prompt:
      "以黑白灰建立主要层级，只保留一种强调色用于关键结论和数据，依靠字号、留白和构图而不是色块堆叠。",
  },
];

export const PPT_TYPOGRAPHY_PREFERENCE_OPTIONS: readonly DesignOption<PptTypographyPreference>[] = [
  {
    id: "auto",
    label: "自动字体",
    prompt:
      "根据视觉风格和受众选择兼容 PowerPoint 的中文与拉丁字体组合，并按 delivery_purpose 锁定正文基准字号。",
  },
  {
    id: "modern",
    label: "现代无衬线",
    prompt:
      "标题和正文使用清晰的现代无衬线字体组合，通过字号、字重和留白形成层级，避免依赖装饰性字体。",
  },
  {
    id: "editorial",
    label: "编辑排版",
    prompt:
      "标题可使用稳健的中文衬线字体，正文使用易读无衬线字体，形成出版物式层级；长文本必须保持足够行距。",
  },
  {
    id: "friendly",
    label: "亲和圆润",
    prompt:
      "使用亲和、圆润但清晰的中文字体气质，适合教学和公众表达；不得牺牲正文可读性或使用过细字重。",
  },
  {
    id: "technical",
    label: "理性技术",
    prompt:
      "使用理性、紧凑的无衬线字体，代码和短标签可使用等宽字体，正文不得整段使用等宽字体。",
  },
];

export function getPptColorPreferenceOption(value?: string) {
  return (
    PPT_COLOR_PREFERENCE_OPTIONS.find((option) => option.id === value) ??
    PPT_COLOR_PREFERENCE_OPTIONS[0]
  );
}

export function getPptTypographyPreferenceOption(value?: string) {
  return (
    PPT_TYPOGRAPHY_PREFERENCE_OPTIONS.find((option) => option.id === value) ??
    PPT_TYPOGRAPHY_PREFERENCE_OPTIONS[0]
  );
}

export function buildPptDesignPreferenceInstruction(input: {
  colorPreference?: PptColorPreference;
  typographyPreference?: PptTypographyPreference;
  phase?: "recommendation" | "planning";
}) {
  const color = getPptColorPreferenceOption(input.colorPreference);
  const typography = getPptTypographyPreferenceOption(
    input.typographyPreference,
  );

  return [
    `- 配色偏好（${color.label}）：${color.prompt}`,
    `- 字体偏好（${typography.label}）：${typography.prompt}`,
    input.phase === "recommendation"
      ? "- 当前只把色板与字体组合写入候选 JSON；完整设计契约在用户确认后生成。"
      : "- 将最终色板、中文/拉丁字体和正文基准字号写入 design_spec.md 与 spec_lock.md；Executor 必须严格使用锁定值。",
  ].join("\n");
}
