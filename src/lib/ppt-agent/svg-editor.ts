import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { getPptProjectDir } from "./paths";

export interface SvgTextNode {
  index: number;
  text: string;
}

export interface SvgEditableElement {
  index: number;
  tag: SvgEditableTag;
  id: string | null;
  label: string;
  text?: string;
  attrs: Record<SvgEditableAttribute, string>;
}

export interface SvgElementUpdate {
  index: number;
  text?: string;
  attrs?: Partial<Record<SvgEditableAttribute, string | null>>;
}

export type SvgEditableTag =
  | "g"
  | "text"
  | "rect"
  | "circle"
  | "ellipse"
  | "line"
  | "path"
  | "polyline"
  | "polygon"
  | "image";

export type SvgEditableAttribute =
  | "id"
  | "x"
  | "y"
  | "width"
  | "height"
  | "cx"
  | "cy"
  | "r"
  | "rx"
  | "ry"
  | "x1"
  | "y1"
  | "x2"
  | "y2"
  | "fill"
  | "stroke"
  | "stroke-width"
  | "font-size"
  | "font-family"
  | "font-weight"
  | "opacity"
  | "transform";

const TEXT_RE = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
const TSPAN_RE = /<tspan\b[^>]*>([\s\S]*?)<\/tspan>/gi;
const OPEN_TAG_RE = /<([A-Za-z_:][\w:.-]*)\b([^<>]*?)(\/?)>/gi;
const ATTR_RE = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
const EDITABLE_TAGS = new Set<SvgEditableTag>([
  "g",
  "text",
  "rect",
  "circle",
  "ellipse",
  "line",
  "path",
  "polyline",
  "polygon",
  "image",
]);
const EDITABLE_ATTRIBUTES = new Set<SvgEditableAttribute>([
  "id",
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "fill",
  "stroke",
  "stroke-width",
  "font-size",
  "font-family",
  "font-weight",
  "opacity",
  "transform",
]);
const TEXT_ATTRIBUTES = new Set<SvgEditableAttribute>(["id", "x", "y", "fill", "stroke", "font-size", "font-family", "font-weight", "opacity", "transform"]);
const GROUP_ATTRIBUTES = new Set<SvgEditableAttribute>(["id", "opacity", "transform"]);
const STYLE_ATTRIBUTE_RE = /\b(id|x|y|width|height|cx|cy|r|rx|ry|x1|y1|x2|y2|fill|stroke|stroke-width|font-size|font-family|font-weight|opacity|transform)\s*:\s*([^;]+)/gi;

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
  if (changed > 0) writeFileSync(path, sanitizeSvg(next), "utf-8");
  return changed;
}

export function readSvgForInlinePreview(projectId: string, slideFile: string) {
  return stripUnsafeSvg(readSvg(projectId, slideFile));
}

export function readSvgEditableElements(projectId: string, slideFile: string): SvgEditableElement[] {
  const content = readSvg(projectId, slideFile);
  const elements: SvgEditableElement[] = [];

  content.replace(OPEN_TAG_RE, (full, rawTag: string, rawAttrs: string, selfClosing: string, offset: number) => {
    const tag = normalizeTag(rawTag);
    if (!EDITABLE_TAGS.has(tag)) return full;
    if (tag === "g" && selfClosing) return full;

    const attrs = collectEditableAttrs(rawAttrs, tag);
    const text = tag === "text" ? decodeXmlText(extractTextContent(readTagInner(content, rawTag, offset + full.length))) : undefined;
    const index = elements.length;
    elements.push({
      index,
      tag,
      id: attrs.id || null,
      label: buildElementLabel(tag, attrs.id, text, index),
      ...(text !== undefined ? { text } : {}),
      attrs,
    });
    return full;
  });

  return elements;
}

export function readAnnotatedSvg(projectId: string, slideFile: string) {
  let editableIndex = 0;
  const content = stripUnsafeSvg(readSvg(projectId, slideFile));

  return content.replace(/<([A-Za-z_:][\w:.-]*)\b([^<>]*?)(\/?)>/gi, (full, rawTag: string, attrs: string, selfClosing: string) => {
    const tag = normalizeTag(rawTag);
    if (!EDITABLE_TAGS.has(tag)) return full;
    if (tag === "g" && selfClosing) return full;
    const next = `<${rawTag}${attrs} data-edit-index="${editableIndex}" data-edit-tag="${tag}"${selfClosing ? " /" : ""}>`;
    editableIndex += 1;
    return next;
  });
}

export function updateSvgElements(projectId: string, slideFile: string, updates: SvgElementUpdate[]) {
  const updateMap = new Map(updates.map((item) => [item.index, item]));
  const path = getSlidePath(projectId, slideFile);
  const content = readFileSync(path, "utf-8");
  let editableIndex = 0;
  let changed = 0;
  let cursor = 0;
  let next = "";
  const matcher = new RegExp(OPEN_TAG_RE.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(content))) {
    const [full, rawTag, rawAttrs, selfClosing] = match;
    const offset = match.index;
    const tag = normalizeTag(rawTag);
    if (!EDITABLE_TAGS.has(tag) || (tag === "g" && selfClosing)) continue;

    const currentIndex = editableIndex;
    editableIndex += 1;
    const update = updateMap.get(currentIndex);
    if (!update) continue;

    const nextAttrs = update.attrs ? updateAttrs(rawAttrs || "", tag, update.attrs) : (rawAttrs || "");
    const canEditText = tag === "text" && update.text !== undefined;
    const updatedOpen = `<${rawTag}${nextAttrs}${selfClosing ? " /" : ""}>`;

    if (!canEditText) {
      if (updatedOpen !== full) {
        next += content.slice(cursor, offset) + updatedOpen;
        cursor = offset + full.length;
        changed += 1;
      }
      continue;
    }

    const closeInfo = findClosingTag(content, rawTag, offset + full.length);
    if (!closeInfo) {
      if (updatedOpen !== full) {
        next += content.slice(cursor, offset) + updatedOpen;
        cursor = offset + full.length;
        changed += 1;
      }
      continue;
    }

    const replacement = `${updatedOpen}${escapeXmlText(update.text || "")}${closeInfo.closeTag}`;
    const original = content.slice(offset, closeInfo.end);
    if (replacement !== original) {
      next += content.slice(cursor, offset) + replacement;
      cursor = closeInfo.end;
      matcher.lastIndex = closeInfo.end;
      changed += 1;
    }
  }

  next += content.slice(cursor);

  if (changed > 0) writeFileSync(path, sanitizeSvg(next), "utf-8");
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

function normalizeTag(tag: string): SvgEditableTag {
  return (tag.split(":").pop() || tag).toLowerCase() as SvgEditableTag;
}

function collectEditableAttrs(rawAttrs: string, tag: SvgEditableTag) {
  const attrs = parseAttributes(rawAttrs);
  const styleAttrs = parseStyleAttributes(attrs.style);
  const allowed = getAllowedAttributes(tag);
  const result = {} as Record<SvgEditableAttribute, string>;

  for (const attr of EDITABLE_ATTRIBUTES) {
    const value = attrs[attr] ?? styleAttrs[attr];
    if (value !== undefined && allowed.has(attr)) result[attr] = decodeXmlText(value);
  }

  return result;
}

function updateAttrs(rawAttrs: string, tag: SvgEditableTag, updates: Partial<Record<SvgEditableAttribute, string | null>>) {
  const allowed = getAllowedAttributes(tag);
  const attrs = parseAttributes(rawAttrs);
  let changed = false;

  for (const [rawName, rawValue] of Object.entries(updates)) {
    const name = rawName as SvgEditableAttribute;
    if (!EDITABLE_ATTRIBUTES.has(name) || !allowed.has(name)) continue;
    const value = sanitizeAttributeValue(name, rawValue);
    if (value === null) {
      if (attrs[name] !== undefined) {
        delete attrs[name];
        changed = true;
      }
      continue;
    }
    if (attrs[name] !== value) {
      attrs[name] = value;
      changed = true;
    }
  }

  if (!changed) return rawAttrs;
  return serializeAttributes(attrs);
}

function getAllowedAttributes(tag: SvgEditableTag) {
  if (tag === "text") return TEXT_ATTRIBUTES;
  if (tag === "g") return GROUP_ATTRIBUTES;
  if (tag === "image") return new Set([...EDITABLE_ATTRIBUTES].filter((attr) => attr !== "font-size" && attr !== "font-family" && attr !== "font-weight" && attr !== "r" && attr !== "cx" && attr !== "cy"));
  return EDITABLE_ATTRIBUTES;
}

function parseAttributes(rawAttrs: string) {
  const attrs: Record<string, string> = {};
  for (const match of rawAttrs.matchAll(ATTR_RE)) {
    const name = match[1];
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "href" || lower === "xlink:href") continue;
    attrs[lower] = match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function parseStyleAttributes(style?: string) {
  const attrs: Partial<Record<SvgEditableAttribute, string>> = {};
  if (!style) return attrs;
  for (const match of style.matchAll(STYLE_ATTRIBUTE_RE)) {
    const name = match[1].toLowerCase() as SvgEditableAttribute;
    if (EDITABLE_ATTRIBUTES.has(name)) attrs[name] = match[2].trim();
  }
  return attrs;
}

function serializeAttributes(attrs: Record<string, string>) {
  const entries = Object.entries(attrs)
    .filter(([name, value]) => isSafeAttributeName(name) && value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  return entries.length
    ? ` ${entries.map(([name, value]) => `${name}="${escapeXmlAttribute(value)}"`).join(" ")}`
    : "";
}

function sanitizeAttributeValue(name: SvgEditableAttribute, value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > 500) return null;

  if (name === "id") {
    const safeId = normalized.replace(/[^A-Za-z0-9_.:-]/g, "-").slice(0, 80);
    return safeId || null;
  }

  if (name === "fill" || name === "stroke") {
    if (normalized === "none" || /^#[0-9A-Fa-f]{3,8}$/.test(normalized) || /^rgb(a)?\([\d\s,%.]+\)$/.test(normalized)) {
      return normalized;
    }
    return null;
  }

  if (name === "font-family") {
    return normalized.replace(/[<>"']/g, "").slice(0, 80) || null;
  }

  if (name === "font-weight") {
    if (/^(normal|bold|[1-9]00)$/.test(normalized)) return normalized;
    return null;
  }

  if (name === "transform") {
    if (/^(matrix|translate|scale|rotate|skewX|skewY)\([0-9eE+\-.,\s]+\)(\s+(matrix|translate|scale|rotate|skewX|skewY)\([0-9eE+\-.,\s]+\))*$/.test(normalized)) {
      return normalized;
    }
    return null;
  }

  if (/^-?\d+(\.\d+)?(%|px|em|rem)?$/.test(normalized)) return normalized;
  return null;
}

function isSafeAttributeName(name: string) {
  return !name.toLowerCase().startsWith("on") && !["href", "xlink:href"].includes(name.toLowerCase());
}

function buildElementLabel(tag: SvgEditableTag, id: string | undefined, text: string | undefined, index: number) {
  if (id) return `${tag} #${id}`;
  const shortText = text?.replace(/\s+/g, " ").trim().slice(0, 20);
  if (shortText) return `${tag} ${shortText}`;
  return `${tag} ${index + 1}`;
}

function extractTextContent(inner: string) {
  if (!/<tspan\b/i.test(inner)) return stripTags(inner).trim();
  return Array.from(inner.matchAll(TSPAN_RE), (match) => stripTags(match[1]).trim())
    .filter(Boolean)
    .join("\n");
}

function readTagInner(content: string, rawTag: string, start: number) {
  const closeInfo = findClosingTag(content, rawTag, start);
  if (!closeInfo) return "";
  return content.slice(start, closeInfo.start);
}

function findClosingTag(content: string, rawTag: string, start: number) {
  const pattern = new RegExp(`</\\s*${escapeRegExp(rawTag)}\\s*>`, "i");
  const match = pattern.exec(content.slice(start));
  if (!match) return null;
  const closeStart = start + match.index;
  return {
    start: closeStart,
    end: closeStart + match[0].length,
    closeTag: match[0],
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function stripUnsafeSvg(svg: string) {
  return sanitizeSvg(svg).replace(/\s(?:href|xlink:href)\s*=\s*["'](?!data:image\/)[^"']*["']/gi, "");
}

function sanitizeSvg(svg: string) {
  return svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[A-Za-z]+\s*=\s*["'][^"']*["']/g, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*["']javascript:[^"']*["']/gi, "");
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

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/'/g, "&apos;");
}
