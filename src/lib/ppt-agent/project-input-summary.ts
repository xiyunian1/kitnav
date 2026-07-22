import {
  PPT_AUDIENCE_OPTIONS,
  PPT_TEXT_VOLUME_OPTIONS,
  PPT_TONE_OPTIONS,
} from "./content-options";
import {
  PPT_COLOR_PREFERENCE_OPTIONS,
  PPT_TYPOGRAPHY_PREFERENCE_OPTIONS,
} from "./design-options";
import { getPptStyleLabel } from "./styles";

export interface PptProjectInputTextSection {
  label: string;
  value: string;
}

export interface PptProjectInputSetting {
  label: string;
  value: string;
}

export interface PptProjectInputSummary {
  textSections: PptProjectInputTextSection[];
  sourceFiles: string[];
  templateFiles: string[];
  settings: PptProjectInputSetting[];
}

export interface PptProjectInputState {
  params?: string | null;
  topic?: string | null;
  sourceText?: string | null;
  sourceTopic?: string | null;
  sourceMarkdown?: string | null;
  sourceFileUrl?: string | null;
  slideCount?: number | null;
  aspectRatio?: string | null;
  style?: string | null;
  model?: string | null;
  audience?: string | null;
  tone?: string | null;
  language?: string | null;
}

export function summarizePptProjectInput(
  project: PptProjectInputState,
): PptProjectInputSummary | null {
  const params = parseObject(project.params);
  const hasStoredParams = Object.keys(params).length > 0;
  const textSections: PptProjectInputTextSection[] = [];
  const seenText = new Set<string>();

  addTextSection(textSections, seenText, "主题与要求", stringAt(params, "prompt"));
  addTextSection(
    textSections,
    seenText,
    "主题",
    stringAt(params, "sourceTopic") ?? project.sourceTopic ?? project.topic,
  );
  addTextSection(
    textSections,
    seenText,
    "Markdown 内容",
    stringAt(params, "sourceMarkdown") ?? project.sourceMarkdown,
  );
  addTextSection(textSections, seenText, "输入内容", project.sourceText);

  const sourcePaths = [
    ...stringArrayAt(params, "sourceFileUrls"),
    ...compactStrings([
      stringAt(params, "sourceFileUrl"),
      project.sourceFileUrl,
    ]),
  ];
  const sourceFiles = resolveDisplayFilenames(
    stringArrayAt(params, "sourceFileNames"),
    sourcePaths,
  );
  const templatePaths = stringArrayAt(params, "templateFileUrls");
  const templateFiles = resolveDisplayFilenames(
    stringArrayAt(params, "templateFileNames"),
    templatePaths,
  );

  if (stringAt(params, "style") === "custom") {
    addTextSection(
      textSections,
      seenText,
      "自定义视觉方向",
      stringAt(params, "stylePrompt"),
    );
  }

  const settings: PptProjectInputSetting[] = [];
  const slideCount = numberAt(params, "slideCount") ?? project.slideCount;
  if (slideCount && slideCount > 0) {
    settings.push({ label: "页数", value: `${slideCount} 页` });
  }
  addSetting(
    settings,
    "页面比例",
    stringAt(params, "aspectRatio") ?? project.aspectRatio,
  );

  const model = stringAt(params, "model") ?? project.model;
  addSetting(
    settings,
    "文案模型",
    formatModel(model, stringAt(params, "modelSource")),
  );
  if (hasStoredParams) {
    const imageModel = stringAt(params, "imageModel");
    addSetting(
      settings,
      "图片模型",
      imageModel
        ? formatModel(imageModel, stringAt(params, "imageModelSource"))
        : "不使用 AI 图片",
    );
  }

  const style = stringAt(params, "style") ?? project.style;
  addSetting(
    settings,
    "视觉风格",
    templateFiles.length > 0
      ? "按上传模板"
      : style
        ? getPptStyleLabel(style, stringAt(params, "styleLabel"))
        : null,
  );
  addSetting(
    settings,
    "文字量",
    optionLabel(PPT_TEXT_VOLUME_OPTIONS, stringAt(params, "textVolume")),
  );
  addSetting(
    settings,
    "面向对象",
    optionLabel(
      PPT_AUDIENCE_OPTIONS,
      stringAt(params, "audience") ?? project.audience,
    ),
  );
  addSetting(
    settings,
    "表达语气",
    optionLabel(PPT_TONE_OPTIONS, stringAt(params, "tone") ?? project.tone),
  );
  addSetting(
    settings,
    "配色",
    optionLabel(
      PPT_COLOR_PREFERENCE_OPTIONS,
      stringAt(params, "colorPreference"),
    ),
  );
  addSetting(
    settings,
    "字体",
    optionLabel(
      PPT_TYPOGRAPHY_PREFERENCE_OPTIONS,
      stringAt(params, "typographyPreference"),
    ),
  );
  addSetting(
    settings,
    "语言",
    project.language ?? (hasStoredParams ? "简体中文" : null),
  );
  addBooleanSetting(settings, params, "visualReview", "视觉复核");
  addBooleanSetting(
    settings,
    params,
    "confirmDesign",
    "生成前预览并调整方案",
  );

  if (
    textSections.length === 0 &&
    sourceFiles.length === 0 &&
    templateFiles.length === 0 &&
    settings.length === 0
  ) {
    return null;
  }

  return { textSections, sourceFiles, templateFiles, settings };
}

function parseObject(value?: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringAt(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

function numberAt(value: Record<string, unknown>, key: string) {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function stringArrayAt(value: Record<string, unknown>, key: string) {
  const item = value[key];
  if (!Array.isArray(item)) return [];
  return compactStrings(item);
}

function compactStrings(values: unknown[]) {
  return values.flatMap((value) =>
    typeof value === "string" && value.trim() ? [value.trim()] : [],
  );
}

function addTextSection(
  sections: PptProjectInputTextSection[],
  seen: Set<string>,
  label: string,
  value?: string | null,
) {
  const normalized = value?.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  sections.push({ label, value: normalized });
}

function addSetting(
  settings: PptProjectInputSetting[],
  label: string,
  value?: string | null,
) {
  const normalized = value?.trim();
  if (normalized) settings.push({ label, value: normalized });
}

function addBooleanSetting(
  settings: PptProjectInputSetting[],
  params: Record<string, unknown>,
  key: string,
  label: string,
) {
  if (typeof params[key] !== "boolean") return;
  settings.push({ label, value: params[key] ? "开启" : "关闭" });
}

function optionLabel(
  options: readonly { id: string; label: string }[],
  value?: string | null,
) {
  if (!value) return null;
  return options.find((option) => option.id === value)?.label ?? value;
}

function formatModel(model?: string | null, source?: string | null) {
  if (!model) return null;
  const sourceLabel =
    source === "user" ? "我的 API" : source === "platform" ? "平台" : null;
  return sourceLabel ? `${model} · ${sourceLabel}` : model;
}

function resolveDisplayFilenames(names: string[], paths: string[]) {
  const count = Math.max(names.length, paths.length);
  const output: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const displayName = safeDisplayFilename(names[index] ?? paths[index]);
    if (displayName && !output.includes(displayName)) output.push(displayName);
  }
  return output;
}

function safeDisplayFilename(value?: string) {
  if (!value) return null;
  const withoutQuery = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value.split(/[?#]/, 1)[0]
    : value;
  const normalized = withoutQuery.replaceAll("\\", "/");
  let filename =
    normalized
      .split("/")
      .pop()
      ?.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
      .trim() ?? "";
  try {
    filename = decodeURIComponent(filename);
  } catch {
    // Keep the original filename when percent encoding is incomplete.
  }
  filename = filename
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
  filename = filename.replace(
    /^\d{10,17}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
  return filename && filename !== "." && filename !== ".."
    ? filename.slice(0, 180)
    : null;
}
