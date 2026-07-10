export const PPT_MASTER_MODE_VALUES = [
  "pyramid",
  "narrative",
  "instructional",
  "showcase",
  "briefing",
] as const;

export const PPT_MASTER_VISUAL_STYLE_VALUES = [
  "swiss-minimal",
  "soft-rounded",
  "glassmorphism",
  "dark-tech",
  "blueprint",
  "editorial",
  "photo-editorial",
  "data-journalism",
  "brutalist",
  "memphis",
  "zine",
  "vintage-poster",
  "paper-cut",
  "sketch-notes",
  "ink-notes",
  "chalkboard",
  "ink-wash",
  "pixel-art",
] as const;

export type PptMasterMode = (typeof PPT_MASTER_MODE_VALUES)[number];
export type PptMasterVisualStyle =
  (typeof PPT_MASTER_VISUAL_STYLE_VALUES)[number];
export type PptMasterModeSelection = PptMasterMode | "auto";
export type PptMasterVisualStyleSelection =
  | PptMasterVisualStyle
  | "auto"
  | "custom";

export interface PptStylePreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
  mode: PptMasterModeSelection;
  visualStyle: PptMasterVisualStyleSelection;
}

export const PPT_STYLE_PRESETS: PptStylePreset[] = [
  {
    id: "auto",
    label: "自动创意",
    description: "按内容从官方叙事模式与视觉风格中自动选择。",
    prompt: "优先遵循上传模板；无模板时根据内容选择具有辨识度的配色、字体、图形语言与封面构图，不套用固定行业默认视觉。",
    mode: "auto",
    visualStyle: "auto",
  },
  {
    id: "general",
    label: "通用演示",
    description: "清晰、稳重，适合大多数汇报场景。",
    prompt: "采用通用商务演示风格：白底或浅色背景，结构清晰，标题醒目，重点用蓝色或绿色强调；每页控制 1 个核心观点，信息层级明确，避免装饰过度。",
    mode: "briefing",
    visualStyle: "soft-rounded",
  },
  {
    id: "business",
    label: "商务简报",
    description: "偏正式的企业汇报与管理沟通。",
    prompt: "采用企业商务简报风格：低饱和配色、网格化排版、页眉页脚克制，强调结论先行、指标、行动项和风险提示；适合管理层快速浏览。",
    mode: "pyramid",
    visualStyle: "swiss-minimal",
  },
  {
    id: "consultant",
    label: "咨询报告",
    description: "结论先行，逻辑框架明显。",
    prompt: "采用咨询报告风格：页面标题写成结论句，使用框架图、矩阵、流程、关键数据卡片；每页有明确 takeaway，版式紧凑但留白充足。",
    mode: "pyramid",
    visualStyle: "swiss-minimal",
  },
  {
    id: "consultant-top",
    label: "高密度咨询",
    description: "信息密度更高，适合战略与分析报告。",
    prompt: "采用高密度顶级咨询报告风格：强结构、强对齐、小字号但可读，使用编号、分组、注释、数据标签和框架图；每页承载较多信息，但必须保持清晰层级。",
    mode: "pyramid",
    visualStyle: "data-journalism",
  },
  {
    id: "tech",
    label: "科技产品",
    description: "适合 AI、SaaS、技术方案和产品能力介绍。",
    prompt: "采用科技产品风格：冷静现代的界面感，使用深浅对比、模块化面板、流程节点、架构图和能力卡片；可以保留 AI、API、LLM 等必要英文术语。",
    mode: "briefing",
    visualStyle: "dark-tech",
  },
  {
    id: "dark-tech",
    label: "深色科技",
    description: "深色背景，突出技术感和发布感。",
    prompt: "采用深色科技风格：深色背景搭配青色、蓝色或绿色强调色，使用发光线条、代码块式信息层、系统架构图；文字必须高对比且不拥挤。",
    mode: "auto",
    visualStyle: "dark-tech",
  },
  {
    id: "minimal",
    label: "极简留白",
    description: "少即是多，适合演讲型内容。",
    prompt: "采用极简留白风格：大留白、少量文字、强标题、单点表达；每页只呈现最关键的信息，用简洁图形辅助理解。",
    mode: "showcase",
    visualStyle: "swiss-minimal",
  },
  {
    id: "education",
    label: "课程培训",
    description: "适合教程、培训、学习路线和知识讲解。",
    prompt: "采用课程培训风格：结构亲和、步骤清楚，使用知识卡片、案例、练习、对比表和阶段进度；语言要适合中文讲解和课堂演示。",
    mode: "instructional",
    visualStyle: "sketch-notes",
  },
  {
    id: "roadmap",
    label: "路线图",
    description: "适合规划、阶段目标和实施路径。",
    prompt: "采用路线图风格：突出阶段、里程碑、依赖关系和时间顺序，常用横向时间轴、泳道图、任务分层和结果指标。",
    mode: "briefing",
    visualStyle: "blueprint",
  },
  {
    id: "pitch",
    label: "融资路演",
    description: "适合商业计划、项目路演和增长叙事。",
    prompt: "采用融资路演风格：叙事清晰、有冲击力，突出痛点、方案、市场、竞争优势、商业模式和增长数据；视觉要专业但有记忆点。",
    mode: "narrative",
    visualStyle: "glassmorphism",
  },
  {
    id: "research",
    label: "研究报告",
    description: "适合行业研究、趋势洞察和调研总结。",
    prompt: "采用研究报告风格：强调证据、来源、趋势、分类和洞察，使用图表占位、数据注释、引用样式和小结；整体应稳重可信。",
    mode: "pyramid",
    visualStyle: "data-journalism",
  },
  {
    id: "product",
    label: "产品发布",
    description: "适合新品介绍、功能发布和版本更新。",
    prompt: "采用产品发布风格：突出产品名称、核心卖点、功能场景、用户价值和发布节奏；页面节奏更有张力，但仍保持中文信息清晰。",
    mode: "showcase",
    visualStyle: "glassmorphism",
  },
  {
    id: "data",
    label: "数据看板",
    description: "适合经营分析、指标复盘和数据汇报。",
    prompt: "采用数据看板风格：强调 KPI、趋势、对比、构成和异常，使用数字卡片、折线/柱状图占位、表格和结论标注；避免无意义装饰。",
    mode: "pyramid",
    visualStyle: "data-journalism",
  },
];

const DEFAULT_STYLE = PPT_STYLE_PRESETS.find((item) => item.id === "auto") || PPT_STYLE_PRESETS[0];

export function getPptStylePreset(id?: string | null) {
  return PPT_STYLE_PRESETS.find((item) => item.id === id) || DEFAULT_STYLE;
}

export function getPptStyleLabel(style?: string | null, styleLabel?: string | null) {
  if (styleLabel?.trim()) return styleLabel.trim();
  return getPptStylePreset(style).label;
}

export function getPptMasterStyleContract(
  style?: string | null,
  stylePrompt?: string | null,
) {
  if (style === "custom") {
    return {
      mode: "auto" as const,
      visualStyle: "custom" as const,
      visualStyleBehavior: stylePrompt?.trim() || "",
    };
  }

  const preset = getPptStylePreset(style);
  return {
    mode: preset.mode,
    visualStyle: preset.visualStyle,
    visualStyleBehavior: "",
  };
}

export function buildPptStyleInstruction(input: {
  style?: string | null;
  stylePrompt?: string | null;
  styleLabel?: string | null;
  projectId?: string | null;
  sourceText?: string | null;
  hasTemplate?: boolean;
}) {
  const style = input.style || DEFAULT_STYLE.id;
  const label = getPptStyleLabel(style, input.styleLabel);
  if (style === "auto" && !input.hasTemplate) {
    return buildAutoCreativeInstruction({
      projectId: input.projectId || "ppt-auto",
      sourceText: input.sourceText || "",
    });
  }
  const prompt = input.stylePrompt?.trim() || getPptStylePreset(style).prompt;
  const contract = getPptMasterStyleContract(style, prompt);
  return [
    `风格名称：${label}`,
    `风格要求：${prompt}`,
    "",
    "PPT Master 官方设计契约：",
    contract.mode === "auto"
      ? "- mode: 读取 references/modes/_index.md 后按内容与受众自动选择，并把一个官方 id 锁定到 spec_lock.md。"
      : `- mode: ${contract.mode}`,
    contract.visualStyle === "auto"
      ? "- visual_style: 读取 references/visual-styles/_index.md，按官方 safe / shifted / bold 光谱评估后锁定最适合内容的官方 id。"
      : `- visual_style: ${contract.visualStyle}`,
    contract.visualStyle === "custom" && contract.visualStyleBehavior
      ? `- visual_style_behavior: ${contract.visualStyleBehavior}`
      : "",
    "- 不得把站内风格名称写成 mode 或 visual_style；Executor 必须加载最终锁定 id 对应的官方参考文件。",
  ].join("\n");
}

export function buildAutoCreativeInstruction(input: {
  projectId: string;
  sourceText?: string | null;
}) {
  const normalizedSource = (input.sourceText || "").replace(/\s+/g, "").trim();
  const shortInput = normalizedSource.length < 120;

  return [
    "风格名称：自动创意",
    "风格模式：无模板自由设计，严格使用 PPT Master 官方模式与视觉风格目录。",
    "- mode: 读取 references/modes/_index.md 后按内容、受众和表达目的自动选择一个官方 id。",
    "- visual_style: 读取 references/visual-styles/_index.md，形成 safe / shifted / bold 三个真实候选；站内自动模式直接锁定最适合内容的候选。",
    "- 把最终 mode 与 visual_style 写入 design_spec.md 和 spec_lock.md，Executor 只加载对应的两个官方参考文件。",
    "- 不得创造目录外的风格名称，不得用固定行业蓝或通用卡片阵列替代官方风格语言。",
    shortInput
      ? "- 当前输入较短：先补全合理的受众、场景和叙事结构，再按已选方向设计；不得杜撰具体数据、机构或来源。"
      : "- 当前资料较完整：从资料中提取受众、场景和叙事结构，并严格保持事实边界。",
  ].join("\n");
}

export function isPptStylePrompt(
  meta?: Record<string, unknown> | null,
  tags: string[] = [],
) {
  const promptModule =
    typeof meta?.module === "string" ? meta.module.toUpperCase() : "";
  const kind = typeof meta?.kind === "string" ? meta.kind.toLowerCase() : "";
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase());
  return (
    promptModule === "PPT" ||
    kind === "ppt-style" ||
    normalizedTags.includes("ppt-style") ||
    tags.some((tag) => tag.trim() === "PPT风格")
  );
}
