import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const NATIVE_PPTX_EXTENSIONS = new Set([
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
]);

export type PptGenerationWorkflow = "svg" | "template-fill";

export interface StagedPptTemplate {
	absolutePath: string;
	relativePath: string;
}

export function resolvePptGenerationWorkflow(input: {
	templateFileUrls?: string[];
}): PptGenerationWorkflow {
	return input.templateFileUrls?.length ? "template-fill" : "svg";
}

export function stageNativePptTemplate(
	projectDir: string,
	templateFileUrls: string[],
): StagedPptTemplate {
	const sourcesDir = join(projectDir, "sources");
	const existingName = existsSync(sourcesDir)
		? readdirSync(sourcesDir).find((name) => {
				const extension = extname(name).toLowerCase();
				return name.startsWith("template-source") && NATIVE_PPTX_EXTENSIONS.has(extension);
			})
		: undefined;
	if (existingName) {
		return {
			absolutePath: join(sourcesDir, existingName),
			relativePath: join("sources", existingName),
		};
	}

	const sourcePath = templateFileUrls[0];
	if (!sourcePath || !existsSync(sourcePath)) {
		throw new Error("上传的 PPT 模板不存在，请重新上传。");
	}

	const extension = extname(sourcePath).toLowerCase();
	if (!NATIVE_PPTX_EXTENSIONS.has(extension)) {
		throw new Error("上传模板必须是 PowerPoint OOXML 文件。");
	}

	const relativePath = join("sources", `template-source${extension}`);
	const absolutePath = join(projectDir, relativePath);
	mkdirSync(sourcesDir, { recursive: true });
	copyFileSync(sourcePath, absolutePath);
	return { absolutePath, relativePath };
}
