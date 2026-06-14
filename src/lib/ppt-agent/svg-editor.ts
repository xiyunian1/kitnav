import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { getPptProjectDir } from "./paths";

export interface SvgTextNode {
  index: number;
  text: string;
}

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const TSPAN_RE = /<tspan\b[^>]*>([\s\S]*?)<\/tspan>/gi;

export function listSvgSlides(projectId: string) {
  const svgDir = join(getPptProjectDir(projectId), "svg_output");
  if (!existsSync(svgDir)) return [];
  return readdirSync(svgDir)
    .filter((file) => /^\d+_.*\.svg$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

export function readSvgTextNodes(projectId: string, slideFile: string): SvgTextNode[] {
  const content = readSvg(projectId, slideFile);
  return Array.from(content.matchAll(TEXT_RE), (match, index) => ({
    index,
    text: decodeXmlText(extractTextContent(match[2])),
  })).filter((item) => item.text.trim());
}

export function updateSvgTextNodes(projectId: string, slideFile: string, updates: SvgTextNode[]) {
  const updateMap = new Map(updates.map((item) => [item.index, item.text]));
  const path = getSlidePath(projectId, slideFile);
  const content = readFileSync(path, "utf-8");
  let index = 0;
  let changed = 0;
  const next = content.replace(TEXT_RE, (full, attrs: string, inner: string) => {
    const value = updateMap.get(index);
    index += 1;
    if (value === undefined) return full;
    const previous = decodeXmlText(extractTextContent(inner));
    if (previous === value) return full;
    changed += 1;
    return `<text${attrs}>${escapeXmlText(value)}</text>`;
  });
  if (changed > 0) writeFileSync(path, next, "utf-8");
  return changed;
}

function readSvg(projectId: string, slideFile: string) {
  return readFileSync(getSlidePath(projectId, slideFile), "utf-8");
}

function getSlidePath(projectId: string, slideFile: string) {
  if (basename(slideFile) !== slideFile || !/^\d+_.*\.svg$/i.test(slideFile)) {
    throw new Error("Invalid slide file");
  }
  const path = join(getPptProjectDir(projectId), "svg_output", slideFile);
  if (!existsSync(path)) throw new Error("Slide not found");
  return path;
}

function extractTextContent(inner: string) {
  if (!/<tspan\b/i.test(inner)) return stripTags(inner).trim();
  return Array.from(inner.matchAll(TSPAN_RE), (match) => stripTags(match[1]).trim())
    .filter(Boolean)
    .join("\n");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
