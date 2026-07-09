export interface PptStylePreset {
  id: string;
  label: string;
  description: string;
  prompt: string;
}

interface AutoCreativeDirection {
  id: string;
  label: string;
  temperament: string;
  palette: string;
  typography: string;
  shapeLanguage: string;
  coverComposition: string;
}

const AUTO_CREATIVE_DIRECTIONS: AutoCreativeDirection[] = [
  {
    id: "editorial-cinnabar",
    label: "朱砂编辑部",
    temperament: "克制、知识感、具有中文杂志气质",
    palette: "米纸白 #F6F1E7、墨黑 #1F2937、朱砂红 #C53A2A、松石绿 #2F6B5F",
    typography: "标题使用 Noto Serif CJK SC / Songti SC / SimSun，正文使用 Microsoft YaHei / PingFang SC",
    shapeLanguage: "细分隔线、跨栏大标题、页码索引和不对称编辑网格；少用圆角卡片",
    coverComposition: "左侧纵向大标题与小号出版信息，右侧使用一块占画面高度的抽象几何主视觉",
  },
  {
    id: "swiss-signal",
    label: "瑞士信号",
    temperament: "理性、直接、强秩序",
    palette: "纯白 #FFFFFF、炭黑 #171717、信号红 #E63946、钴蓝 #2563EB",
    typography: "标题使用 SimHei / Arial Black，正文使用 Microsoft YaHei / Arial",
    shapeLanguage: "严格基线网格、实心矩形、粗细线对比和醒目编号；直角优先",
    coverComposition: "超大编号占据一侧，标题沿网格对齐，另一侧用高对比色块切分画面",
  },
  {
    id: "midnight-lime",
    label: "午夜荧光",
    temperament: "前沿、锐利、数字产品感",
    palette: "夜黑 #111315、石墨 #1C2024、荧光黄绿 #D7FF4F、冷白 #F5F7FA、钢蓝灰 #8AA4B8",
    typography: "标题使用 Arial Black / SimHei，正文使用 Microsoft YaHei / Arial",
    shapeLanguage: "高对比暗色画布、角标、细线框、模块切片和局部荧光标记",
    coverComposition: "标题贴近左下安全区，右上使用单个大型线框符号或斜切结构形成张力",
  },
  {
    id: "plum-paper",
    label: "梅紫纸艺",
    temperament: "温润、文化感、精致但不古板",
    palette: "暖白 #FAF7F2、梅紫 #4A1942、芥末金 #D4A72C、深青 #1F4E5F",
    typography: "标题使用 Noto Serif CJK SC / Songti SC，正文使用 PingFang SC / Microsoft YaHei",
    shapeLanguage: "层叠纸带、窄边框、局部印章式标签和大面积呼吸留白",
    coverComposition: "标题居于偏上区域，底部用两到三层错位纸带建立景深，不使用路线曲线",
  },
  {
    id: "cobalt-coral",
    label: "钴蓝珊瑚",
    temperament: "清爽、积极、现代品牌感",
    palette: "雾白 #F7F8FC、钴蓝 #243B6B、珊瑚 #F26B5B、暖黄 #E3B341",
    typography: "标题使用 SimHei / Arial，正文使用 Microsoft YaHei / PingFang SC",
    shapeLanguage: "几何切片、色带、图文错位和少量实心圆点；避免浅蓝绿色科技模板感",
    coverComposition: "标题跨越左侧两列，右侧用三块不同尺度的几何切片组合成主视觉",
  },
  {
    id: "forest-amber",
    label: "森林琥珀",
    temperament: "沉稳、自然、适合长期主义叙事",
    palette: "亚麻白 #F5F2E8、森林绿 #24493D、琥珀 #D98E32、酒红 #8C3B45",
    typography: "标题使用 Noto Serif CJK SC / SimSun，正文使用 Microsoft YaHei / Arial",
    shapeLanguage: "拱形边界、层级色带、细线标注和有机但克制的轮廓",
    coverComposition: "中央偏左放置短标题，右侧以一组高低错落的拱形或层叠地形承载主题",
  },
  {
    id: "mono-violet",
    label: "黑白紫电",
    temperament: "大胆、实验、具有展览海报感",
    palette: "骨白 #F4F4F0、纯黑 #161616、电紫 #7C3AED、酸橙 #C7F000",
    typography: "标题使用 Arial Black / SimHei，正文使用 Microsoft YaHei / Arial",
    shapeLanguage: "超大文字、裁切字块、粗描边和少量高饱和标记；避免常规卡片阵列",
    coverComposition: "标题放大到接近画布边缘，以裁切文字作为主视觉，右下保留短副标题",
  },
  {
    id: "atlas-clay",
    label: "图谱陶土",
    temperament: "研究感、可靠、略带手工温度",
    palette: "灰白 #FBFBF8、深靛 #25324B、陶土 #E05A47、橄榄 #7A8B5A",
    typography: "标题使用 Noto Serif CJK SC / Songti SC，正文使用 Microsoft YaHei / PingFang SC",
    shapeLanguage: "地图式索引、坐标注释、细线连接和不规则信息块；边角保持简洁",
    coverComposition: "左上使用小型主题索引，中央放大标题，背景以稀疏坐标与单个色块建立图谱感",
  },
  {
    id: "neo-ink",
    label: "新中式墨印",
    temperament: "东方、留白、适合观点与文化叙事",
    palette: "宣纸 #F7F1E3、浓墨 #1D1D1B、印泥红 #A8322D、竹青 #55705A",
    typography: "标题使用 Noto Serif CJK SC / STSong / SimSun，正文使用 Microsoft YaHei / PingFang SC",
    shapeLanguage: "大留白、竖向索引、墨块般实心几何和印章式强调；不仿古纹样堆叠",
    coverComposition: "标题按横竖文字节奏错落排列，右下以单个墨块和小型红色印记收束画面",
  },
];

export const PPT_STYLE_PRESETS: PptStylePreset[] = [
  {
    id: "auto",
    label: "自动创意",
    description: "按内容与任务随机种子生成不同视觉方向。",
    prompt: "优先遵循上传模板；无模板时根据内容选择具有辨识度的配色、字体、图形语言与封面构图，不套用固定行业默认视觉。",
  },
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

const DEFAULT_STYLE = PPT_STYLE_PRESETS.find((item) => item.id === "auto") || PPT_STYLE_PRESETS[0];

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
  if (/^风格名称：/m.test(prompt) || /^风格要求：/m.test(prompt)) return prompt;
  return [`风格名称：${label}`, `风格要求：${prompt}`].join("\n");
}

export function buildAutoCreativeInstruction(input: {
  projectId: string;
  sourceText?: string | null;
}) {
  const seed = stableHash(input.projectId);
  const start = seed % AUTO_CREATIVE_DIRECTIONS.length;
  const candidates = [0, 1, 2].map(
    (offset) => AUTO_CREATIVE_DIRECTIONS[(start + offset) % AUTO_CREATIVE_DIRECTIONS.length],
  );
  const selected = candidates[(seed >>> 8) % candidates.length];
  const normalizedSource = (input.sourceText || "").replace(/\s+/g, "").trim();
  const shortInput = normalizedSource.length < 120;

  return [
    "风格名称：自动创意",
    "风格模式：无模板自由设计。以下项目专属方向来自任务 ID 的稳定选择；同一项目可复现，不同项目会获得不同候选组合。",
    "",
    "候选视觉方向：",
    ...candidates.map(
      (candidate, index) =>
        `${index + 1}. ${candidate.label}：${candidate.temperament}；封面采用${candidate.coverComposition}`,
    ),
    "",
    `最终选择：${selected.label}（${selected.id}）`,
    `- 视觉气质：${selected.temperament}`,
    `- 配色锁定：${selected.palette}`,
    `- 字体策略：${selected.typography}`,
    `- 图形语言：${selected.shapeLanguage}`,
    `- 封面构图：${selected.coverComposition}`,
    "- 将以上精确方向写入 Eight Confirmations、design_spec.md 和 spec_lock.md；这些颜色属于明确风格输入，不得再改用行业默认配色表。",
    "- 页面结构仍应根据内容选择合适图表和节奏，不能为了套视觉方向而牺牲信息表达。",
    shortInput
      ? "- 当前输入较短：先补全合理的受众、场景和叙事结构，再按已选方向设计；不得杜撰具体数据、机构或来源。"
      : "- 当前资料较完整：从资料中提取受众、场景和叙事结构，并严格保持事实边界。",
  ].join("\n");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
