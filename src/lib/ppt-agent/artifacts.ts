import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const HEX_RE = /^#[0-9A-Fa-f]{3,8}$/;

export function collectPptArtifactPaths(projectDir: string, pptxPath?: string) {
  const designSpecPath = join(projectDir, "design_spec.md");
  const specLockPath = join(projectDir, "spec_lock.md");
  const svgOutputPath = join(projectDir, "svg_output");

  return {
    specPath: existsSync(designSpecPath) ? designSpecPath : undefined,
    specLockPath: existsSync(specLockPath) ? specLockPath : undefined,
    svgOutputPath: existsSync(svgOutputPath) ? svgOutputPath : undefined,
    pptxPath: pptxPath || undefined,
  };
}

export function normalizePptSvgArtifacts(projectDir: string) {
  const namedGroups = ensureTopLevelGroupIds(projectDir);
  const addedColors = syncSpecLockColors(projectDir);
  const addedFonts = syncSpecLockFontFamilies(projectDir);
  return { namedGroups, addedColors, addedFonts };
}

function ensureTopLevelGroupIds(projectDir: string) {
  const svgDir = join(projectDir, "svg_output");
  if (!existsSync(svgDir) || !statSync(svgDir).isDirectory()) return 0;

  let changed = 0;
  for (const file of readdirSync(svgDir).filter((item) => item.toLowerCase().endsWith(".svg")).sort()) {
    const path = join(svgDir, file);
    const original = readFileSync(path, "utf-8");
    const updated = addMissingTopLevelGroupIds(original);
    if (updated !== original) {
      writeFileSync(path, updated, "utf-8");
      changed += 1;
    }
  }
  return changed;
}

function addMissingTopLevelGroupIds(svg: string) {
  const root = svg.match(/<svg\b[^>]*>/i);
  if (!root || root.index === undefined) return svg;

  const existingIds = new Set(Array.from(svg.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi), (match) => match[1]));
  const inserts: Array<{ index: number; value: string }> = [];
  let sequence = 1;
  let depth = 0;
  let index = root.index + root[0].length;

  while (index < svg.length) {
    const open = svg.indexOf("<", index);
    if (open === -1) break;

    if (svg.startsWith("<!--", open)) {
      const close = svg.indexOf("-->", open + 4);
      index = close === -1 ? svg.length : close + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", open)) {
      const close = svg.indexOf("]]>", open + 9);
      index = close === -1 ? svg.length : close + 3;
      continue;
    }
    if (svg.startsWith("<?", open)) {
      const close = svg.indexOf("?>", open + 2);
      index = close === -1 ? svg.length : close + 2;
      continue;
    }

    const close = svg.indexOf(">", open + 1);
    if (close === -1) break;

    const tag = svg.slice(open, close + 1);
    const closeMatch = tag.match(/^<\s*\/\s*([A-Za-z_:][\w:.-]*)/);
    if (closeMatch) {
      const tagName = closeMatch[1].split(":").pop()?.toLowerCase();
      if (tagName === "svg" && depth === 0) break;
      depth = Math.max(0, depth - 1);
      index = close + 1;
      continue;
    }

    const openMatch = tag.match(/^<\s*([A-Za-z_:][\w:.-]*)/);
    if (!openMatch) {
      index = close + 1;
      continue;
    }

    const tagName = openMatch[1].split(":").pop()?.toLowerCase();
    const selfClosing = /\/\s*>$/.test(tag);
    if (depth === 0 && tagName === "g" && !/\sid\s*=/.test(tag)) {
      const id = nextGroupId(existingIds, sequence);
      sequence += 1;
      existingIds.add(id);
      inserts.push({ index: open + openMatch[0].length, value: ` id="${id}"` });
    }
    if (!selfClosing) depth += 1;
    index = close + 1;
  }

  if (inserts.length === 0) return svg;
  let updated = svg;
  for (const insert of inserts.sort((a, b) => b.index - a.index)) {
    updated = `${updated.slice(0, insert.index)}${insert.value}${updated.slice(insert.index)}`;
  }
  return updated;
}

function nextGroupId(existingIds: Set<string>, start: number) {
  let index = start;
  while (true) {
    const id = `auto-layer-${String(index).padStart(2, "0")}`;
    if (!existingIds.has(id)) return id;
    index += 1;
  }
}

function syncSpecLockColors(projectDir: string) {
  const specLockPath = join(projectDir, "spec_lock.md");
  const svgDir = join(projectDir, "svg_output");
  if (!existsSync(specLockPath) || !existsSync(svgDir) || !statSync(svgDir).isDirectory()) return 0;

  const colors = collectSvgAttributeColors(svgDir);
  if (colors.size === 0) return 0;

  const original = readFileSync(specLockPath, "utf-8");
  const lines = original.split(/\r?\n/);
  const section = findSectionBounds(lines, "colors");
  if (!section) return 0;

  const existingValues = new Set<string>();
  let maxAutoIndex = 0;
  for (const line of lines.slice(section.start + 1, section.end)) {
    const value = line.match(/:\s*(#[0-9A-Fa-f]{3,8})\b/)?.[1];
    if (value && HEX_RE.test(value)) existingValues.add(value.toUpperCase());
    const autoKey = line.match(/^-\s+auto_color_(\d+)\s*:/);
    if (autoKey) maxAutoIndex = Math.max(maxAutoIndex, Number(autoKey[1]));
  }

  const missing = Array.from(colors).filter((color) => !existingValues.has(color));
  if (missing.length === 0) return 0;

  const additions = missing.map((color, offset) => {
    const key = `auto_color_${String(maxAutoIndex + offset + 1).padStart(2, "0")}`;
    return `- ${key}: ${color}`;
  });
  const updated = insertSectionLines(lines, section, additions);
  writeFileSync(specLockPath, preserveTrailingNewline(original, updated), "utf-8");
  return additions.length;
}

function syncSpecLockFontFamilies(projectDir: string) {
  const specLockPath = join(projectDir, "spec_lock.md");
  const svgDir = join(projectDir, "svg_output");
  if (!existsSync(specLockPath) || !existsSync(svgDir) || !statSync(svgDir).isDirectory()) return 0;

  const families = collectSvgFontFamilies(svgDir);
  if (families.size === 0) return 0;

  const original = readFileSync(specLockPath, "utf-8");
  const lines = original.split(/\r?\n/);
  const section = findSectionBounds(lines, "typography");
  if (!section) return 0;

  const existingValues = new Set<string>();
  let maxAutoIndex = 0;
  for (const line of lines.slice(section.start + 1, section.end)) {
    const entry = line.match(/^-\s+([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!entry) continue;
    const [, key, value] = entry;
    if (key === "font_family" || key.endsWith("_family")) existingValues.add(value.trim());
    const autoKey = key.match(/^auto_(\d+)_family$/);
    if (autoKey) maxAutoIndex = Math.max(maxAutoIndex, Number(autoKey[1]));
  }

  const missing = Array.from(families).filter((family) => !existingValues.has(family));
  if (missing.length === 0) return 0;

  const additions = missing.map((family, offset) => {
    const key = `auto_${String(maxAutoIndex + offset + 1).padStart(2, "0")}_family`;
    return `- ${key}: ${family}`;
  });
  const updated = insertSectionLines(lines, section, additions);
  writeFileSync(specLockPath, preserveTrailingNewline(original, updated), "utf-8");
  return additions.length;
}

function collectSvgAttributeColors(svgDir: string) {
  const colors = new Set<string>();
  for (const file of readdirSync(svgDir).filter((item) => item.toLowerCase().endsWith(".svg")).sort()) {
    const content = readFileSync(join(svgDir, file), "utf-8");
    for (const match of content.matchAll(/\b(?:fill|stroke|stop-color)\s*=\s*["'](#[0-9A-Fa-f]{3,8})["']/g)) {
      colors.add(match[1].toUpperCase());
    }
  }
  return colors;
}

function collectSvgFontFamilies(svgDir: string) {
  const families = new Set<string>();
  for (const file of readdirSync(svgDir).filter((item) => item.toLowerCase().endsWith(".svg")).sort()) {
    const content = readFileSync(join(svgDir, file), "utf-8");
    for (const match of content.matchAll(/\bfont-family\s*=\s*["']([^"']+)["']/g)) {
      families.add(match[1].trim());
    }
  }
  return families;
}

function findSectionBounds(lines: string[], sectionName: string) {
  const start = lines.findIndex((line) => line.trim() === `## ${sectionName}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function insertSectionLines(lines: string[], section: { start: number; end: number }, additions: string[]) {
  let insertAt = section.end;
  while (insertAt > section.start + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  return [
    ...lines.slice(0, insertAt),
    ...additions,
    ...lines.slice(insertAt),
  ].join("\n");
}

function preserveTrailingNewline(original: string, updated: string) {
  return original.endsWith("\n") ? `${updated.replace(/\n?$/, "")}\n` : updated.replace(/\n$/, "");
}
