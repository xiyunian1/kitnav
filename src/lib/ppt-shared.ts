export const PPT_GENERATION_MODES = [
  {
    value: "FREEFORM",
    label: "自由生成",
    description: "由 AI 按主题重新规划结构、文案与视觉风格，适合从零生成一份新 PPT。",
  },
  {
    value: "TEMPLATE",
    label: "模板生成",
    description: "按 GordenPPTSkill 的模板工作流生成内容，优先匹配模板页与文本槽位。",
  },
] as const;

export const PPT_STYLES = [
  { value: "BUSINESS", label: "商务汇报" },
  { value: "MINIMAL", label: "极简白底" },
  { value: "TECH", label: "科技产品" },
  { value: "EDUCATION", label: "教学培训" },
  { value: "PITCH", label: "融资路演" },
] as const;

export const PPT_TONES = [
  { value: "PROFESSIONAL", label: "专业稳重" },
  { value: "PERSUASIVE", label: "说服力强" },
  { value: "CLEAR", label: "清晰易懂" },
  { value: "STORY", label: "故事化" },
] as const;

export const LEGACY_PPT_STRUCTURES = [
  {
    value: "AUTO",
    label: "智能推荐",
    description: "根据主题自动选择最合适的叙事结构。",
  },
  {
    value: "CONSULTING",
    label: "咨询汇报",
    description: "适合战略、复盘、运营分析，强调结论和证据链。",
  },
  {
    value: "PITCH_DECK",
    label: "融资路演",
    description: "适合商业计划书、产品融资，突出故事线和增长潜力。",
  },
  {
    value: "PRODUCT_LAUNCH",
    label: "产品发布",
    description: "适合功能介绍、发布会、方案演示，强调场景和卖点。",
  },
  {
    value: "TRAINING",
    label: "培训课件",
    description: "适合课程、内训、知识分享，结构清晰便于理解。",
  },
  {
    value: "RESEARCH",
    label: "研究报告",
    description: "适合行业分析、调研报告，强调数据、洞察和趋势。",
  },
] as const;

export const GORDEN_PPT_TEMPLATES = [
  {
    value: "minimal-business-summary",
    label: "简约商务总结汇报",
    pages: 16,
    color: "深蓝白 #485275",
    category: "summary",
    description: "极简商务，留白多，适合季度、年度汇报。",
  },
  {
    value: "red-patriot-youth",
    label: "新时代新青年红色教育",
    pages: 16,
    color: "党政红 #A91F1F + 金",
    category: "party",
    description: "庄重党政红，适合思政课件、主题教育。",
  },
  {
    value: "cute-orange-class",
    label: "橙色可爱卡通教学",
    pages: 17,
    color: "暖橙 #F5C97E",
    category: "training",
    description: "卡通手绘风，适合幼儿、小学、培训课件。",
  },
  {
    value: "quarterly-illust",
    label: "蓝灰酸性插画季度总结",
    pages: 19,
    color: "亮蓝 #4F4FFF + 黑白",
    category: "summary",
    description: "Y2K 酸性设计，适合互联网风季度总结。",
  },
  {
    value: "geometric-summary",
    label: "多彩几何工作总结",
    pages: 21,
    color: "蓝/红/黄/绿",
    category: "summary",
    description: "几何切片与大字标题，活力型工作总结。",
  },
  {
    value: "red-patriot-general",
    label: "红色爱国主题教育通用",
    pages: 25,
    color: "党政红 #A8181C",
    category: "party",
    description: "金色书法与绸缎飘带，适合党课、主题党日。",
  },
  {
    value: "thesis-novice",
    label: "多专业开题方法论库",
    pages: 32,
    color: "墨绿 #4F6E4F",
    category: "thesis",
    description: "跨专业研究方法范例，适合开题答辩。",
  },
  {
    value: "premium-corp",
    label: "高级感大厂 PPT 合辑",
    pages: 35,
    color: "酱红 #A52524 + 深蓝灰",
    category: "business",
    description: "战略、运营、数据和思维模型类高级版式。",
  },
  {
    value: "architecture-deck",
    label: "领导爱的架构图合辑",
    pages: 37,
    color: "深蓝 #1F3A93",
    category: "architecture",
    description: "项目、AI、物流、供应链等架构图场景。",
  },
  {
    value: "mckinsey-style",
    label: "麦肯锡风专业模板",
    pages: 37,
    color: "酱红 + 深蓝灰",
    category: "consulting",
    description: "金字塔、漏斗、对比、总分等咨询逻辑结构。",
  },
  {
    value: "report-massive-models",
    label: "汇报合辑·思维模型与复盘",
    pages: 38,
    color: "深蓝 #1E3A5F",
    category: "business",
    description: "SWOT、PDCA、KISS、鱼骨、个人复盘。",
  },
  {
    value: "report-massive-charts",
    label: "汇报合辑·数据图表与业绩",
    pages: 38,
    color: "深蓝 #1E3A5F",
    category: "data",
    description: "漏斗、树状、齿轮、财务销售、转化分析。",
  },
  {
    value: "thesis-formula",
    label: "开题报告万能公式",
    pages: 39,
    color: "暖米 #F6F0DC + 深蓝",
    category: "thesis",
    description: "背景、意义、现状、方法四段开题公式。",
  },
  {
    value: "top-thesis",
    label: "名校开题报告合辑",
    pages: 39,
    color: "酒红 #7A2B22",
    category: "thesis",
    description: "学术酒红开题模板，适合正式答辩。",
  },
  {
    value: "data-viz-deck",
    label: "数据可视化合辑",
    pages: 41,
    color: "深蓝 #2C3E70 + 砖红",
    category: "data",
    description: "20+ 原生图表页，适合数据可视化重型汇报。",
  },
  {
    value: "report-massive-reports",
    label: "汇报合辑·工作汇报与竞聘",
    pages: 37,
    color: "深蓝 #1E3A5F",
    category: "business",
    description: "工作汇报、岗位竞聘、金字塔和漏斗逻辑。",
  },
  {
    value: "report-savior",
    label: "汇报救命合辑",
    pages: 44,
    color: "深蓝 #1F3A93 + 亮红",
    category: "business",
    description: "商业汇报全场景，含 SWOT、PEST、鱼骨等。",
  },
  {
    value: "operations-deck",
    label: "运营 PPT 合辑",
    pages: 52,
    color: "深蓝 #1F3A93 + 亮蓝",
    category: "operations",
    description: "私域、产品生命周期、数据看板等运营场景。",
  },
  {
    value: "competition-speech",
    label: "竞聘述职合辑",
    pages: 59,
    color: "深蓝 #1B3464 + 砖红",
    category: "career",
    description: "竞聘、述职、项目复盘，含 KISS、PDCA、SWOT。",
  },
] as const;

export const PPT_TEMPLATES = GORDEN_PPT_TEMPLATES;

export type PptGenerationMode = (typeof PPT_GENERATION_MODES)[number]["value"];
export type PptStyle = (typeof PPT_STYLES)[number]["value"];
export type PptTone = (typeof PPT_TONES)[number]["value"];
export type LegacyPptStructure = (typeof LEGACY_PPT_STRUCTURES)[number]["value"];
export type GordenPptTemplate = (typeof GORDEN_PPT_TEMPLATES)[number]["value"];
export type PptTemplate = LegacyPptStructure | GordenPptTemplate;

export interface PptSlideContent {
  id?: string;
  order: number;
  title: string;
  subtitle?: string;
  layout: "COVER" | "AGENDA" | "CONTENT" | "SECTION" | "COMPARISON" | "TIMELINE" | "SUMMARY" | "THANKS";
  bullets: string[];
  speakerNotes?: string;
  visualPrompt?: string;
  accent?: string;
  imageUrl?: string;
  imagePrompt?: string;
  imageModel?: string;
  imageStatus?: "PENDING" | "SUCCESS" | "FAILED" | "";
  imageError?: string;
  imageDurationMs?: number | null;
}

export interface PptOutlineSlide {
  order: number;
  title: string;
  subtitle?: string;
  layout: PptSlideContent["layout"];
  bullets: string[];
  speakerNotes?: string;
  visualPrompt?: string;
  accent?: string;
}

export interface PptTheme {
  primary: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  font: string;
}

export interface SerializedPptProject {
  id: string;
  title: string;
  topic: string;
  audience: string;
  generationMode: PptGenerationMode;
  style: string;
  tone: string;
  template: PptTemplate;
  templateLabel: string;
  slideCount: number;
  sourceText: string;
  status: string;
  model: string;
  theme: PptTheme;
  creditsCost: number;
  usedOwnKey: boolean;
  createdAt: string;
  updatedAt: string;
  slides: PptSlideContent[];
}
