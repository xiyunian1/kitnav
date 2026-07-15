import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PPT_PROJECTS_ROOT } from "./paths";
import { convertDocumentToMarkdown } from "./source-converters";

export const MAX_PPT_SOURCE_MARKDOWN_CHARS = 80_000;
export const THIN_PPT_SOURCE_MEANINGFUL_CHARS = 500;

export interface PptSourceParams {
	sourceType: "topic" | "document" | "markdown";
	sourceTopic?: string;
	sourceFileUrl?: string;
	sourceMarkdown?: string;
	prompt?: string;
	sourceFileUrls?: string[];
}

export async function resolveSourceMarkdown(
	params: PptSourceParams,
	projectDir: string,
) {
	if (
		params.prompt ||
		params.sourceFileUrls?.length
	) {
		return assertPptSourceMarkdownLength(
			await resolveCombinedSourceMarkdown(params, projectDir),
		);
	}

	if (params.sourceType === "topic") {
		return assertPptSourceMarkdownLength(
			`# ${params.sourceTopic?.trim() || "未命名主题"}\n\n请围绕该主题生成结构完整、逻辑清晰、可直接演示的 PPT。`,
		);
	}

	if (params.sourceType === "markdown") {
		return assertPptSourceMarkdownLength(params.sourceMarkdown?.trim() || "");
	}

	if (params.sourceType === "document") {
		if (!params.sourceFileUrl) throw new Error("请先上传文档。");
		const outputPath = join(projectDir, "sources", "source.md");
		return assertPptSourceMarkdownLength(
			await convertDocumentToMarkdown(params.sourceFileUrl, outputPath),
		);
	}

	throw new Error("不支持的 PPT 输入来源。");
}

export function assertPptSourceMarkdownLength(source: string) {
	if (source.length > MAX_PPT_SOURCE_MARKDOWN_CHARS) {
		throw new Error("资料总文字量超过 8 万字符，请减少文件或精简内容后重试。");
	}
	return source;
}

export function isThinPptSource(source: string) {
	const meaningful = source.replace(/[\s#>*_`~\-|\[\](){}:：,，.。!?！？]/g, "");
	return meaningful.length < THIN_PPT_SOURCE_MEANINGFUL_CHARS;
}

async function resolveCombinedSourceMarkdown(
	params: PptSourceParams,
	projectDir: string,
) {
	const sections: string[] = [];
	const prompt = params.prompt?.trim();
	const files = uniqueStrings(params.sourceFileUrls || []);

	if (prompt) {
		sections.push(["# 用户需求", "", prompt].join("\n"));
	}

	for (const [index, filePath] of files.entries()) {
		const outputPath = join(
			projectDir,
			"sources",
			`document_${String(index + 1).padStart(2, "0")}.md`,
		);
		const content = await convertDocumentToMarkdown(filePath, outputPath);
		sections.push([`# 文件资料 ${index + 1}`, "", content].join("\n"));
	}

	if (sections.length === 0) {
		throw new Error("请描述你想生成的 PPT，或添加文件资料。");
	}

	return sections.join("\n\n---\n\n");
}

function uniqueStrings(values: string[]) {
	return Array.from(
		new Set(values.map((value) => value.trim()).filter(Boolean)),
	);
}

export function ensureProjectStructure(
	projectDir: string,
	projectId: string,
	canvasFormat: string,
) {
	mkdirSync(PPT_PROJECTS_ROOT, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(join(projectDir, "svg_output"), { recursive: true });
	mkdirSync(join(projectDir, "svg_final"), { recursive: true });
	mkdirSync(join(projectDir, "images"), { recursive: true });
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	mkdirSync(join(projectDir, "notes"), { recursive: true });
	mkdirSync(join(projectDir, "templates"), { recursive: true });
	mkdirSync(join(projectDir, "sources"), { recursive: true });
	mkdirSync(join(projectDir, "exports"), { recursive: true });

	const readmePath = join(projectDir, "README.md");
	if (!existsSync(readmePath)) {
		writeFileSync(
			readmePath,
			`# ${projectId}\n\n- Canvas format: ${canvasFormat}\n- Created by integrated PPT Master agent runner\n`,
			"utf-8",
		);
	}
}

export function clampSlideCount(value: number) {
	if (!Number.isFinite(value)) return 10;
	return Math.max(3, Math.min(30, Math.round(value)));
}
