import { cpSync, existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, resolve, sep } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";

export type PptTemplateKind = "brand" | "layout" | "deck";

export interface PptTemplateOption {
  id: string;
  kind: PptTemplateKind;
  value: string;
  title: string;
  summary: string;
  primaryColor?: string;
  canvasFormat?: string;
  pageCount?: number;
}

interface TemplateIndexEntry {
  summary?: string;
  primary_color?: string;
  canvas_format?: string;
  page_count?: number;
}

const TEMPLATE_KIND_DIR: Record<PptTemplateKind, string> = {
  brand: "brands",
  layout: "layouts",
  deck: "decks",
};

const TEMPLATE_KIND_LABEL: Record<PptTemplateKind, string> = {
  brand: "品牌",
  layout: "版式",
  deck: "整套模板",
};

export function listPptTemplateOptions(): PptTemplateOption[] {
  return (Object.keys(TEMPLATE_KIND_DIR) as PptTemplateKind[]).flatMap((kind) => {
    const dir = getTemplateKindDir(kind);
    const index = readTemplateIndex(kind);
    if (!existsSync(dir)) return [];

    const availableIds = new Set(
      readdirSync(dir).filter((item) => {
        const path = join(dir, item);
        return statSync(path).isDirectory();
      })
    );
    const ids = new Set([...Object.keys(index), ...availableIds]);

    return Array.from(ids)
      .filter((id) => isSafeTemplateId(id) && availableIds.has(id))
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
      .map((id) => {
        const meta = index[id] || {};
        return {
          id,
          kind,
          value: `${kind}:${id}`,
          title: `${TEMPLATE_KIND_LABEL[kind]} · ${id}`,
          summary: meta.summary || "",
          primaryColor: meta.primary_color,
          canvasFormat: meta.canvas_format,
          pageCount: meta.page_count,
        };
      });
  });
}

export function preparePptTemplateSelection(selection: string | undefined, projectDir: string) {
  const parsed = parseTemplateSelection(selection);
  if (!parsed) return "";

  const sourceDir = getTemplateDir(parsed.kind, parsed.id);
  const allowed = new Set(listPptTemplateOptions().map((item) => item.value));
  if (!allowed.has(`${parsed.kind}:${parsed.id}`)) {
    throw new Error("选择的 PPT 模板不存在。");
  }

  const targetRelative = join("templates", TEMPLATE_KIND_DIR[parsed.kind], parsed.id).replaceAll("\\", "/");
  const targetDir = join(projectDir, targetRelative);
  cpSync(sourceDir, targetDir, { recursive: true, force: true });

  return [
    `已选择 PPT Master ${TEMPLATE_KIND_LABEL[parsed.kind]}模板：${parsed.id}`,
    `项目内模板路径：${targetRelative}`,
    "必须按 PPT Master Step 3 读取并应用该模板目录中的 design_spec.md 和资源文件。",
  ].join("\n");
}

function parseTemplateSelection(selection?: string) {
  const value = selection?.trim();
  if (!value || value === "none") return null;
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":").trim();
  if (!isTemplateKind(kind) || !isSafeTemplateId(id)) {
    throw new Error("PPT 模板参数不正确。");
  }
  return { kind, id };
}

function readTemplateIndex(kind: PptTemplateKind): Record<string, TemplateIndexEntry> {
  const indexPath = join(getTemplateKindDir(kind), `${TEMPLATE_KIND_DIR[kind]}_index.json`);
  if (!existsSync(indexPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getTemplateKindDir(kind: PptTemplateKind) {
  const skillDir = getPptMasterSkillDir();
  if (kind === "brand") return join(skillDir, "templates", "brands");
  if (kind === "layout") return join(skillDir, "templates", "layouts");
  return join(skillDir, "templates", "decks");
}

function getTemplateDir(kind: PptTemplateKind, id: string) {
  const root = getTemplateKindDir(kind);
  const resolved = resolve(/*turbopackIgnore: true*/ root, id);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && resolved.startsWith(normalizedRoot)) return resolved;
  throw new Error("PPT 模板路径非法。");
}

function isTemplateKind(value: string): value is PptTemplateKind {
  return value === "brand" || value === "layout" || value === "deck";
}

function isSafeTemplateId(id: string) {
  return Boolean(id) && !id.includes("/") && !id.includes("\\") && !id.includes("..");
}
