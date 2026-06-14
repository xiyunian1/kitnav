import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PPT_PROJECTS_ROOT } from "./paths";
import { convertDocumentToMarkdown, convertUrlToMarkdownFile } from "./source-converters";

export interface PptSourceParams {
  sourceType: "topic" | "document" | "url" | "markdown";
  sourceTopic?: string;
  sourceFileUrl?: string;
  sourceUrl?: string;
  sourceMarkdown?: string;
}

export async function resolveSourceMarkdown(params: PptSourceParams, projectDir: string) {
  if (params.sourceType === "topic") {
    return `# ${params.sourceTopic?.trim() || "未命名主题"}\n\n请围绕该主题生成结构完整、逻辑清晰、可直接演示的 PPT。`;
  }

  if (params.sourceType === "markdown") {
    return params.sourceMarkdown?.trim() || "";
  }

  if (params.sourceType === "url") {
    if (!params.sourceUrl) throw new Error("请输入网页 URL。");
    const outputPath = join(projectDir, "sources", "source.md");
    return convertUrlToMarkdownFile(params.sourceUrl, outputPath);
  }

  if (params.sourceType === "document") {
    if (!params.sourceFileUrl) throw new Error("请先上传文档。");
    const outputPath = join(projectDir, "sources", "source.md");
    return convertDocumentToMarkdown(params.sourceFileUrl, outputPath);
  }

  throw new Error("不支持的 PPT 输入来源。");
}

export function ensureProjectStructure(projectDir: string, projectId: string, canvasFormat: string) {
  mkdirSync(PPT_PROJECTS_ROOT, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(join(projectDir, "svg_output"), { recursive: true });
  mkdirSync(join(projectDir, "svg_final"), { recursive: true });
  mkdirSync(join(projectDir, "images"), { recursive: true });
  mkdirSync(join(projectDir, "notes"), { recursive: true });
  mkdirSync(join(projectDir, ["templ", "ates"].join("")), { recursive: true });
  mkdirSync(join(projectDir, "sources"), { recursive: true });
  mkdirSync(join(projectDir, "exports"), { recursive: true });

  const readmePath = join(projectDir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${projectId}\n\n- Canvas format: ${canvasFormat}\n- Created by integrated PPT Master agent runner\n`,
      "utf-8"
    );
  }
}

export function clampSlideCount(value: number) {
  if (!Number.isFinite(value)) return 10;
  return Math.max(3, Math.min(30, Math.round(value)));
}
