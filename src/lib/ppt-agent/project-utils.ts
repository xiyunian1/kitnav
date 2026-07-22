import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, relative } from "path";
import { PPT_PROJECTS_ROOT } from "./paths";
import {
	analyzePptSourceImages,
	collectConvertedSourceImages,
	convertDocumentToMarkdown,
	runPptxSourceIntake,
	stagePptSourceOriginal,
} from "./source-converters";

export { clampSlideCount } from "./slide-count";

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
		return fitPptSourceMarkdown(
			`# ${params.sourceTopic?.trim() || "未命名主题"}\n\n请围绕该主题生成结构完整、逻辑清晰、可直接演示的 PPT。`,
		);
	}

	if (params.sourceType === "markdown") {
		return fitPptSourceMarkdown(params.sourceMarkdown?.trim() || "");
	}

	if (params.sourceType === "document") {
		if (!params.sourceFileUrl) throw new Error("请先上传文档。");
		const prepared = await prepareSourceDocument(
			params.sourceFileUrl,
			1,
			projectDir,
		);
		await finishSourceAnalysis(projectDir, [prepared]);
		return fitPptSourceMarkdown(buildDocumentSection(projectDir, prepared, true));
	}

	throw new Error("不支持的 PPT 输入来源。");
}

export function assertPptSourceMarkdownLength(source: string) {
	return fitPptSourceMarkdown(source);
}

export function fitPptSourceMarkdown(
	source: string,
	maxChars = MAX_PPT_SOURCE_MARKDOWN_CHARS,
) {
	if (source.length <= maxChars) return source;
	const notice = [
		"# 资料导航",
		"",
		"资料全文超过当前规划上下文容量，以下按章节保留结构化摘录。完整转换稿仍保存在 sources/，必须结合 analysis/source_index.json 按需读取，不能把未展示部分视为不存在。",
		"",
	].join("\n");
	const budget = Math.max(0, maxChars - notice.length);
	return `${notice}${compactMarkdownSections(source, budget)}`.slice(0, maxChars);
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
	const preparedDocuments: PreparedSourceDocument[] = [];

	if (prompt) {
		sections.push(["# 用户需求", "", prompt].join("\n"));
	}

	for (const [index, filePath] of files.entries()) {
		const prepared = await prepareSourceDocument(filePath, index + 1, projectDir);
		preparedDocuments.push(prepared);
		sections.push(buildDocumentSection(projectDir, prepared, false));
	}

	if (sections.length === 0) {
		throw new Error("请描述你想生成的 PPT，或添加文件资料。");
	}

	await finishSourceAnalysis(projectDir, preparedDocuments);
	return fitPptSourceMarkdown(sections.join("\n\n---\n\n"));
}

function uniqueStrings(values: string[]) {
	return Array.from(
		new Set(values.map((value) => value.trim()).filter(Boolean)),
	);
}

interface PreparedSourceDocument {
	index: number;
	originalPath: string;
	markdownPath: string;
	content: string;
	imagePaths: string[];
	pptxIntake: boolean;
}

async function prepareSourceDocument(
	inputPath: string,
	index: number,
	projectDir: string,
): Promise<PreparedSourceDocument> {
	const sequence = String(index).padStart(2, "0");
	const extension = extname(inputPath).toLowerCase();
	const originalPath = join(
		projectDir,
		"sources",
		"originals",
		`document_${sequence}${extension}`,
	);
	stagePptSourceOriginal(inputPath, originalPath);
	const markdownPath = join(projectDir, "sources", `document_${sequence}.md`);
	const content = await convertDocumentToMarkdown(inputPath, markdownPath);
	const imagePaths = collectConvertedSourceImages(
		markdownPath,
		join(projectDir, "images"),
		`source_${sequence}`,
	);
	const pptxIntake = await runPptxSourceIntake(
		originalPath,
		join(projectDir, "analysis"),
	);
	return { index, originalPath, markdownPath, content, imagePaths, pptxIntake };
}

async function finishSourceAnalysis(
	projectDir: string,
	documents: PreparedSourceDocument[],
) {
	if (documents.length === 0) return;
	await analyzePptSourceImages(join(projectDir, "images"));
	const sourceIndex = {
		schema: "ppt_hosted_source_index.v1",
		documentCount: documents.length,
		documents: documents.map((document) => ({
			index: document.index,
			originalPath: projectRelative(projectDir, document.originalPath),
			markdownPath: projectRelative(projectDir, document.markdownPath),
			characters: document.content.length,
			pptxIntake: document.pptxIntake,
			images: document.imagePaths.map((path) => projectRelative(projectDir, path)),
		})),
	};
	writeFileSync(
		join(projectDir, "analysis", "source_index.json"),
		`${JSON.stringify(sourceIndex, null, 2)}\n`,
		"utf-8",
	);
}

function buildDocumentSection(
	projectDir: string,
	document: PreparedSourceDocument,
	single: boolean,
) {
	const path = projectRelative(projectDir, document.markdownPath);
	return [
		single ? "# 文件资料" : `# 文件资料 ${document.index}`,
		"",
		`- 完整转换稿：${path}`,
		`- 提取图片：${document.imagePaths.length} 张`,
		document.pptxIntake ? "- 已生成 PPTX 结构化 intake" : "",
		"",
		document.content,
	]
		.filter(Boolean)
		.join("\n");
}

function compactMarkdownSections(source: string, budget: number) {
	if (budget <= 0) return "";
	const starts = Array.from(source.matchAll(/^#{1,6}\s+.+$/gm)).map(
		(match) => match.index || 0,
	);
	if (starts.length === 0) {
		const head = Math.ceil(budget * 0.8);
		const tail = Math.max(0, budget - head - 24);
		return `${source.slice(0, head)}\n\n[中间内容已省略]\n\n${source.slice(-tail)}`;
	}
	const sections = starts.map((start, index) =>
		source.slice(start, starts[index + 1] ?? source.length).trim(),
	);
	const perSection = Math.max(160, Math.floor(budget / sections.length));
	return sections
		.map((section) => {
			if (section.length <= perSection) return section;
			return `${section.slice(0, Math.max(0, perSection - 16)).trimEnd()}\n[本节其余内容见完整转换稿]`;
		})
		.join("\n\n")
		.slice(0, budget);
}

function projectRelative(projectDir: string, path: string) {
	return relative(projectDir, path).replaceAll("\\", "/");
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
	mkdirSync(join(projectDir, "validation"), { recursive: true });
	mkdirSync(join(projectDir, ".preview"), { recursive: true });
	mkdirSync(join(projectDir, ".review"), { recursive: true });

	const readmePath = join(projectDir, "README.md");
	if (!existsSync(readmePath)) {
		writeFileSync(
			readmePath,
			`# ${projectId}\n\n- Canvas format: ${canvasFormat}\n- Created by integrated PPT Master agent runner\n`,
			"utf-8",
		);
	}
}
