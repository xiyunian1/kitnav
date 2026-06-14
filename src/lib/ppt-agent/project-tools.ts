import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { executePptPython, getPptScriptPath } from "./python-tools";

export const TRANSITION_EFFECTS = ["none", "fade", "push", "wipe", "split", "strips", "cover", "random"] as const;
export const ANIMATION_EFFECTS = [
  "none",
  "auto",
  "mixed",
  "random",
  "appear",
  "fade",
  "fly",
  "cut",
  "zoom",
  "wipe",
  "split",
  "blinds",
  "checkerboard",
  "dissolve",
  "random_bars",
  "peek",
  "wheel",
  "box",
  "circle",
  "diamond",
  "plus",
  "strips",
  "wedge",
  "stretch",
  "expand",
  "swivel",
] as const;
export const ANIMATION_TRIGGERS = ["on-click", "with-previous", "after-previous"] as const;
export const AUDIO_PROVIDERS = ["edge", "elevenlabs", "minimax", "qwen", "cosyvoice"] as const;

export interface PptAnimationSettings {
  transition: (typeof TRANSITION_EFFECTS)[number];
  transitionDuration: number;
  animation: (typeof ANIMATION_EFFECTS)[number];
  animationTrigger: (typeof ANIMATION_TRIGGERS)[number];
  animationDuration: number;
  animationStagger: number;
  autoAdvance?: number | null;
}

export interface PptAudioSettings {
  provider: (typeof AUDIO_PROVIDERS)[number];
  voice: string;
  voiceId?: string;
  rate: string;
  locale: string;
}

const DEFAULT_ANIMATION_SETTINGS: PptAnimationSettings = {
  transition: "fade",
  transitionDuration: 0.4,
  animation: "auto",
  animationTrigger: "after-previous",
  animationDuration: 0.4,
  animationStagger: 0.5,
  autoAdvance: null,
};

const DEFAULT_AUDIO_SETTINGS: PptAudioSettings = {
  provider: "edge",
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "+0%",
  locale: "zh-CN",
};

export function readAnimationSettings(projectDir: string): PptAnimationSettings {
  const path = join(projectDir, "animations.json");
  if (!existsSync(path)) return DEFAULT_ANIMATION_SETTINGS;
  try {
    const config = JSON.parse(readFileSync(path, "utf-8"));
    return normalizeAnimationSettings(config);
  } catch {
    return DEFAULT_ANIMATION_SETTINGS;
  }
}

export async function writeAnimationSettings(projectDir: string, input: Partial<PptAnimationSettings>) {
  const settings = normalizeAnimationSettings(input);
  const previous = readAnimationConfig(projectDir);
  const animationConfig = {
    version: 1,
    defaults: {
      transition: {
        effect: settings.transition,
        duration: settings.transitionDuration,
        ...(settings.autoAdvance ? { autoAdvance: settings.autoAdvance } : {}),
      },
      animation: {
        effect: settings.animation,
        trigger: settings.animationTrigger,
        duration: settings.animationDuration,
        stagger: settings.animationStagger,
      },
    },
    slides: previous.slides || {},
  };
  writeFileSync(join(projectDir, "animations.json"), `${JSON.stringify(animationConfig, null, 2)}\n`, "utf-8");
  await validateAnimationConfig(projectDir);
  return settings;
}

export async function listAnimationGroups(projectDir: string) {
  const result = await executePptPython(getPptScriptPath("animation_config.py"), ["list-groups", projectDir], 60_000);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function validateAnimationConfig(projectDir: string) {
  await executePptPython(getPptScriptPath("animation_config.py"), ["validate", projectDir], 60_000);
}

export function readAudioSettings(projectDir: string): PptAudioSettings {
  const path = join(projectDir, "audio", "settings.json");
  if (!existsSync(path)) return DEFAULT_AUDIO_SETTINGS;
  try {
    return normalizeAudioSettings(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function listAudioFiles(projectDir: string) {
  const audioDir = join(projectDir, "audio");
  if (!existsSync(audioDir)) return [];
  return readdirSync(audioDir)
    .filter((file) => [".mp3", ".m4a", ".wav"].includes(extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map((file) => ({ filename: file }));
}

export async function generateNarrationAudio(projectDir: string, input: Partial<PptAudioSettings>) {
  const settings = normalizeAudioSettings(input);
  const outputDir = join(projectDir, "audio");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

  const args = [
    projectDir,
    "--output",
    outputDir,
    "--provider",
    settings.provider,
    "--rate",
    settings.rate,
    "--locale",
    settings.locale,
  ];
  if (settings.voice) args.push("--voice", settings.voice);
  if (settings.voiceId) args.push("--voice-id", settings.voiceId);

  const result = await executePptPython(getPptScriptPath("notes_to_audio.py"), args, 600_000);
  return { settings, files: listAudioFiles(projectDir), output: result.stdout || result.stderr };
}

export async function listCommonVoices(locale = "zh-CN") {
  const result = await executePptPython(
    getPptScriptPath("notes_to_audio.py"),
    ["--list-common-voices", "--locale", locale],
    60_000
  );
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function readImagePromptArtifacts(projectDir: string) {
  const mdPath = join(projectDir, "images", "image_prompts.md");
  const jsonPath = join(projectDir, "images", "image_prompts.json");
  let markdown = "";
  let manifest: unknown = null;

  if (existsSync(mdPath)) markdown = readFileSync(mdPath, "utf-8");
  if (existsSync(jsonPath)) {
    try {
      manifest = JSON.parse(readFileSync(jsonPath, "utf-8"));
    } catch {
      manifest = null;
    }
  }

  return { markdown, manifest };
}

export function listProjectImages(projectDir: string) {
  const imagesDir = join(projectDir, "images");
  if (!existsSync(imagesDir)) return [];
  return readdirSync(imagesDir)
    .filter((file) => [".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(extname(file).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map((file) => ({ filename: file }));
}

export function saveProjectImage(projectDir: string, filename: string, data: Buffer) {
  const safeName = basename(filename).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  if (!safeName || ![".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(extname(safeName).toLowerCase())) {
    throw new Error("不支持的图片格式");
  }
  const imagesDir = join(projectDir, "images");
  mkdirSync(imagesDir, { recursive: true });
  writeFileSync(join(imagesDir, safeName), data);
  return safeName;
}

export function readImportedTemplate(projectDir: string) {
  const templateDir = join(projectDir, "templates", "imported");
  const summaryPath = join(templateDir, "summary.md");
  const manifestPath = join(templateDir, "manifest.json");
  const svgDir = existsSync(join(templateDir, "svg-flat")) ? join(templateDir, "svg-flat") : join(templateDir, "svg");
  let manifest: unknown = null;
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      manifest = null;
    }
  }

  return {
    exists: existsSync(templateDir),
    summary: existsSync(summaryPath) ? readFileSync(summaryPath, "utf-8") : "",
    manifest,
    slides: existsSync(svgDir)
      ? readdirSync(svgDir)
          .filter((file) => file.toLowerCase().endsWith(".svg"))
          .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
          .map((filename) => ({ filename, directory: svgDir.endsWith("svg-flat") ? "templates/imported/svg-flat" : "templates/imported/svg" }))
      : [],
  };
}

export async function importPptxTemplate(projectDir: string, filename: string, data: Buffer) {
  const safeName = basename(filename).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  if (!safeName || extname(safeName).toLowerCase() !== ".pptx") {
    throw new Error("请上传 PPTX 模板文件");
  }

  const sourceDir = join(projectDir, "template_uploads");
  const outputDir = join(projectDir, "templates", "imported");
  mkdirSync(sourceDir, { recursive: true });
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  const sourcePath = join(sourceDir, safeName);
  writeFileSync(sourcePath, data);
  const result = await executePptPython(
    getPptScriptPath("pptx_template_import.py"),
    [sourcePath, "--output", outputDir, "--inheritance-mode", "both"],
    300_000
  );
  return { filename: safeName, output: result.stdout || result.stderr, template: readImportedTemplate(projectDir) };
}

function normalizeAnimationSettings(input: unknown): PptAnimationSettings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const defaults = value.defaults && typeof value.defaults === "object" ? value.defaults as Record<string, unknown> : {};
  const transitionValue =
    value.transition && typeof value.transition === "object"
      ? value.transition as Record<string, unknown>
      : defaults.transition && typeof defaults.transition === "object"
        ? defaults.transition as Record<string, unknown>
        : {};
  const animationValue =
    value.animation && typeof value.animation === "object"
      ? value.animation as Record<string, unknown>
      : defaults.animation && typeof defaults.animation === "object"
        ? defaults.animation as Record<string, unknown>
        : {};

  return {
    transition: pick(TRANSITION_EFFECTS, value.transition ?? transitionValue.effect, DEFAULT_ANIMATION_SETTINGS.transition),
    transitionDuration: clampNumber(value.transitionDuration ?? transitionValue.duration, 0.1, 5, DEFAULT_ANIMATION_SETTINGS.transitionDuration),
    animation: pick(ANIMATION_EFFECTS, value.animation ?? animationValue.effect, DEFAULT_ANIMATION_SETTINGS.animation),
    animationTrigger: pick(ANIMATION_TRIGGERS, value.animationTrigger ?? animationValue.trigger, DEFAULT_ANIMATION_SETTINGS.animationTrigger),
    animationDuration: clampNumber(value.animationDuration ?? animationValue.duration, 0.1, 5, DEFAULT_ANIMATION_SETTINGS.animationDuration),
    animationStagger: clampNumber(value.animationStagger ?? animationValue.stagger, 0, 5, DEFAULT_ANIMATION_SETTINGS.animationStagger),
    autoAdvance: normalizeOptionalNumber(value.autoAdvance ?? transitionValue.autoAdvance, 0.5, 120),
  };
}

function readAnimationConfig(projectDir: string) {
  const path = join(projectDir, "animations.json");
  if (!existsSync(path)) return { version: 1, slides: {} as Record<string, unknown> };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : { version: 1, slides: {} };
  } catch {
    return { version: 1, slides: {} };
  }
}

function normalizeAudioSettings(input: unknown): PptAudioSettings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  return {
    provider: pick(AUDIO_PROVIDERS, value.provider, DEFAULT_AUDIO_SETTINGS.provider),
    voice: normalizeText(value.voice, DEFAULT_AUDIO_SETTINGS.voice, 120),
    voiceId: normalizeOptionalText(value.voiceId, 160),
    rate: normalizeRate(value.rate),
    locale: normalizeText(value.locale, DEFAULT_AUDIO_SETTINGS.locale, 20),
  };
}

function pick<const T extends readonly string[]>(allowed: T, value: unknown, fallback: T[number]): T[number] {
  return allowed.includes(String(value) as T[number]) ? String(value) as T[number] : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeOptionalNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.min(max, Math.max(min, number));
}

function normalizeText(value: unknown, fallback: string, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return (text || fallback).replace(/[<>"']/g, "").slice(0, max);
}

function normalizeOptionalText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/[<>"']/g, "") : "";
  return text ? text.slice(0, max) : undefined;
}

function normalizeRate(value: unknown) {
  const text = typeof value === "string" ? value.trim() : DEFAULT_AUDIO_SETTINGS.rate;
  return /^[+-]\d{1,3}%$/.test(text) ? text : DEFAULT_AUDIO_SETTINGS.rate;
}
