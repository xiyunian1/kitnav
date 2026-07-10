export const PPT_TEXT_VOLUME_VALUES = ["concise", "balanced", "detailed"] as const;
export const PPT_AUDIENCE_VALUES = [
  "general",
  "executives",
  "professionals",
  "technical",
  "customers",
  "students",
  "public",
] as const;
export const PPT_TONE_VALUES = [
  "natural",
  "professional",
  "formal",
  "casual",
  "persuasive",
  "inspiring",
  "educational",
  "analytical",
  "narrative",
  "humorous",
] as const;

export type PptTextVolume = (typeof PPT_TEXT_VOLUME_VALUES)[number];
export type PptAudience = (typeof PPT_AUDIENCE_VALUES)[number];
export type PptTone = (typeof PPT_TONE_VALUES)[number];
export type PptDeliveryPurpose = "presentation" | "balanced" | "text";

interface ContentOption<T extends string> {
  id: T;
  label: string;
  prompt: string;
}

export const PPT_TEXT_VOLUME_OPTIONS: readonly ContentOption<PptTextVolume>[] = [
  {
    id: "concise",
    label: "精简",
    prompt: "每页只保留一个核心结论，正文优先使用 2-4 个短要点，删除重复解释和次要细节。",
  },
  {
    id: "balanced",
    label: "适中",
    prompt: "每页围绕一个核心观点展开，正文通常使用 3-5 个要点，并补充必要的例子或数据。",
  },
  {
    id: "detailed",
    label: "详细",
    prompt: "保留关键背景、论据、案例和行动建议，使用 4-6 个要点或分组内容，但不得通过缩小字号塞入过量文字。",
  },
];

export const PPT_AUDIENCE_OPTIONS: readonly ContentOption<PptAudience>[] = [
  {
    id: "general",
    label: "通用受众",
    prompt: "使用无需专业背景也能理解的表达，首次出现的术语要给出简短解释。",
  },
  {
    id: "executives",
    label: "管理层",
    prompt: "结论先行，突出关键指标、业务影响、风险、决策点和下一步行动。",
  },
  {
    id: "professionals",
    label: "专业人士",
    prompt: "可以使用行业术语，强调方法、证据、专业判断和可执行细节。",
  },
  {
    id: "technical",
    label: "技术人员",
    prompt: "突出架构、实现路径、约束、依赖和技术取舍，避免空泛的宣传表达。",
  },
  {
    id: "customers",
    label: "客户与伙伴",
    prompt: "从对方价值出发，突出使用场景、收益、差异点、可信依据和合作方式。",
  },
  {
    id: "students",
    label: "学生与学员",
    prompt: "循序渐进地讲解概念，使用例子、对比、步骤和阶段小结帮助理解。",
  },
  {
    id: "public",
    label: "公众",
    prompt: "使用通俗、清晰、有叙事性的语言，减少行话并强调与日常生活的关联。",
  },
];

export const PPT_TONE_OPTIONS: readonly ContentOption<PptTone>[] = [
  { id: "natural", label: "自然", prompt: "表达清楚、克制、易读，不刻意使用口号。" },
  { id: "professional", label: "专业", prompt: "表达准确、可靠、有条理，保持专业可信度。" },
  { id: "formal", label: "正式", prompt: "使用正式、严谨、适合公开汇报的措辞。" },
  { id: "casual", label: "轻松", prompt: "语言亲切自然，适合非正式交流，但避免网络化和随意表达。" },
  { id: "persuasive", label: "说服", prompt: "以明确主张、证据和收益推动受众接受观点或采取行动。" },
  { id: "inspiring", label: "鼓舞", prompt: "突出愿景、意义、进展和可能性，保持真诚并避免空洞口号。" },
  { id: "educational", label: "教学", prompt: "像教师讲解一样定义概念、拆分步骤，并安排例子和总结。" },
  { id: "analytical", label: "分析", prompt: "强调事实、因果、对比、假设和推导过程，明确区分结论与依据。" },
  { id: "narrative", label: "叙事", prompt: "用背景、冲突、转折和结果组织内容，使页面之间形成连贯故事线。" },
  { id: "humorous", label: "幽默", prompt: "适度使用轻松类比和机智表达，不牺牲准确性或专业边界。" },
];

export interface PptContentPreferences {
  textVolume?: PptTextVolume;
  audience?: PptAudience;
  tone?: PptTone;
}

export function getPptTextVolumeOption(value?: string) {
  return PPT_TEXT_VOLUME_OPTIONS.find((option) => option.id === value) ?? PPT_TEXT_VOLUME_OPTIONS[1];
}

export function getPptAudienceOption(value?: string) {
  return PPT_AUDIENCE_OPTIONS.find((option) => option.id === value) ?? PPT_AUDIENCE_OPTIONS[0];
}

export function getPptToneOption(value?: string) {
  return PPT_TONE_OPTIONS.find((option) => option.id === value) ?? PPT_TONE_OPTIONS[0];
}

export function getPptDeliveryPurpose(value?: string): PptDeliveryPurpose {
  if (value === "concise") return "presentation";
  if (value === "detailed") return "text";
  return "balanced";
}

export function buildPptContentInstruction(input: PptContentPreferences = {}) {
  const textVolume = getPptTextVolumeOption(input.textVolume);
  const audience = getPptAudienceOption(input.audience);
  const tone = getPptToneOption(input.tone);

  return [
    `- 文字量（${textVolume.label}）：${textVolume.prompt}`,
    `- 面向对象（${audience.label}）：${audience.prompt}`,
    `- 表达语气（${tone.label}）：${tone.prompt}`,
    "- 以上要求必须体现在可见幻灯片文案中。优先保证可读性和模板版式，不得用过小字号容纳文字；内容超出页面容量时，应压缩次要信息并在目标页数内合理分配。",
  ].join("\n");
}
