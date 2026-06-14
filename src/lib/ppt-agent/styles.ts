export interface PptStylePreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

export interface PptStyleMaterialOption {
  id: string;
  title: string;
  description: string | null;
  promptText: string;
  ownerName: string;
  source: "mine" | "favorite" | "public";
}

export const PPT_STYLE_PRESETS: PptStylePreset[] = [
  {
    id: "general",
    label: "通用演示",
    description: "清晰、稳重，适合大多数汇报场景。",
    prompt: "采用通用商务演示风格：白底或浅色背景，结构清晰，标题醒目，重点用蓝色或绿色强调；每页控制 1 个核心观点，信息层级明确，避免装饰过度。",
  },
  {
    id: "business",
    label: "商务简报",
    description: "偏正式的企业汇报与管理沟通。",
    prompt: "采用企业商务简报风格：低饱和配色、网格化排版、页眉页脚克制，强调结论先行、指标、行动项和风险提示；适合管理层快速浏览。",
  },
  {
    id: "consultant",
    label: "咨询报告",
    description: "结论先行，逻辑框架明显。",
    prompt: "采用咨询报告风格：页面标题写成结论句，使用框架图、矩阵、流程、关键数据卡片；每页有明确 takeaway，版式紧凑但留白充足。",
  },
  {
    id: "consultant-top",
    label: "高密度咨询",
    description: "信息密度更高，适合战略与分析报告。",
    prompt: "采用高密度顶级咨询报告风格：强结构、强对齐、小字号但可读，使用编号、分组、注释、数据标签和框架图；每页承载较多信息，但必须保持清晰层级。",
  },
  {
    id: "tech",
    label: "科技产品",
    description: "适合 AI、SaaS、技术方案和产品能力介绍。",
    prompt: "采用科技产品风格：冷静现代的界面感，使用深浅对比、模块化面板、流程节点、架构图和能力卡片；可以保留 AI、API、LLM 等必要英文术语。",
  },
  {
    id: "dark-tech",
    label: "深色科技",
    description: "深色背景，突出技术感和发布感。",
    prompt: "采用深色科技风格：深色背景搭配青色、蓝色或绿色强调色，使用发光线条、代码块式信息层、系统架构图；文字必须高对比且不拥挤。",
  },
  {
    id: "minimal",
    label: "极简留白",
    description: "少即是多，适合演讲型内容。",
    prompt: "采用极简留白风格：大留白、少量文字、强标题、单点表达；每页只呈现最关键的信息，用简洁图形辅助理解。",
  },
  {
    id: "education",
    label: "课程培训",
    description: "适合教程、培训、学习路线和知识讲解。",
    prompt: "采用课程培训风格：结构亲和、步骤清楚，使用知识卡片、案例、练习、对比表和阶段进度；语言要适合中文讲解和课堂演示。",
  },
  {
    id: "roadmap",
    label: "路线图",
    description: "适合规划、阶段目标和实施路径。",
    prompt: "采用路线图风格：突出阶段、里程碑、依赖关系和时间顺序，常用横向时间轴、泳道图、任务分层和结果指标。",
  },
  {
    id: "pitch",
    label: "融资路演",
    description: "适合商业计划、项目路演和增长叙事。",
    prompt: "采用融资路演风格：叙事清晰、有冲击力，突出痛点、方案、市场、竞争优势、商业模式和增长数据；视觉要专业但有记忆点。",
  },
  {
    id: "research",
    label: "研究报告",
    description: "适合行业研究、趋势洞察和调研总结。",
    prompt: "采用研究报告风格：强调证据、来源、趋势、分类和洞察，使用图表占位、数据注释、引用样式和小结；整体应稳重可信。",
  },
  {
    id: "product",
    label: "产品发布",
    description: "适合新品介绍、功能发布和版本更新。",
    prompt: "采用产品发布风格：突出产品名称、核心卖点、功能场景、用户价值和发布节奏；页面节奏更有张力，但仍保持中文信息清晰。",
  },
  {
    id: "data",
    label: "数据看板",
    description: "适合经营分析、指标复盘和数据汇报。",
    prompt: "采用数据看板风格：强调 KPI、趋势、对比、构成和异常，使用数字卡片、折线/柱状图占位、表格和结论标注；避免无意义装饰。",
  },
];

const DEFAULT_STYLE = PPT_STYLE_PRESETS[0];

export function getPptStylePreset(id?: string | null) {
  return PPT_STYLE_PRESETS.find((item) => item.id === id) || DEFAULT_STYLE;
}

export function getPptStyleLabel(style?: string | null, styleLabel?: string | null) {
  if (styleLabel?.trim()) return styleLabel.trim();
  return getPptStylePreset(style).label;
}

export function buildPptStyleInstruction(input: {
  style?: string | null;
  stylePrompt?: string | null;
  styleLabel?: string | null;
}) {
  const label = getPptStyleLabel(input.style, input.styleLabel);
  const prompt = input.stylePrompt?.trim() || getPptStylePreset(input.style).prompt;
  return [`风格名称：${label}`, `风格要求：${prompt}`].join("\n");
}

export function isPptStylePrompt(
  meta?: Record<string, unknown> | null,
  tags: string[] = []
) {
  const promptModule = typeof meta?.module === "string" ? meta.module.toUpperCase() : "";
  const kind = typeof meta?.kind === "string" ? meta.kind.toLowerCase() : "";
  const normalizedTags = tags.map((tag) => tag.trim().toLowerCase());
  return (
    promptModule === "PPT" ||
    kind === "ppt-style" ||
    normalizedTags.includes("ppt-style") ||
    tags.some((tag) => tag.trim() === "PPT风格")
  );
}
