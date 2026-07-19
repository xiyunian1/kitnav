import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "fs";
import { mkdir } from "fs/promises";
import { basename, dirname, extname, join, resolve } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";
import { getPptPythonCommand } from "./python-tools";
import { runBoundedProcess } from "./bounded-process";
import {
	assertInsideUploadRoot,
	getPptUploadRoot,
	resolveUploadPath,
} from "./upload-paths";

const DOCUMENT_CONVERTERS: Record<
	string,
	{ script: string[]; extraArgs?: string[] }
> = {
	".pdf": { script: ["source_to_md", "pdf_to_md.py"] },
	".docx": { script: ["source_to_md", "doc_to_md.py"] },
	".html": { script: ["source_to_md", "doc_to_md.py"] },
	".htm": { script: ["source_to_md", "doc_to_md.py"] },
	".epub": { script: ["source_to_md", "doc_to_md.py"] },
	".ipynb": { script: ["source_to_md", "doc_to_md.py"] },
	".pptx": { script: ["source_to_md", "ppt_to_md.py"] },
	".pptm": { script: ["source_to_md", "ppt_to_md.py"] },
	".ppsx": { script: ["source_to_md", "ppt_to_md.py"] },
	".ppsm": { script: ["source_to_md", "ppt_to_md.py"] },
	".potx": { script: ["source_to_md", "ppt_to_md.py"] },
	".potm": { script: ["source_to_md", "ppt_to_md.py"] },
	".xlsx": { script: ["source_to_md", "excel_to_md.py"] },
	".xlsm": { script: ["source_to_md", "excel_to_md.py"] },
};
const MAX_CONVERTED_MARKDOWN_BYTES = 1024 * 1024;
const SOURCE_IMAGE_EXTENSIONS = new Set([
	".bmp",
	".gif",
	".jpeg",
	".jpg",
	".png",
	".svg",
	".tif",
	".tiff",
	".webp",
]);
const PPTX_SOURCE_EXTENSIONS = new Set([
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
]);

export { getPptUploadRoot, resolveUploadPath };

export async function convertDocumentToMarkdown(
	inputPath: string,
	outputPath: string,
) {
	const resolvedInput = resolve(inputPath);
	assertInsideUploadRoot(resolvedInput);
	if (!existsSync(resolvedInput))
		throw new Error("上传文档不存在，请重新上传。");

	const ext = extname(resolvedInput).toLowerCase();
	const converter = DOCUMENT_CONVERTERS[ext];
	if (!converter) throw new Error("不支持的 PPT 文档格式。");

	await mkdir(dirname(outputPath), { recursive: true });
	const scriptPath = resolve(
		getPptMasterSkillDir(),
		"scripts",
		...converter.script,
	);
	await executePython(scriptPath, [resolvedInput, "-o", outputPath], 300_000);
	return readConvertedMarkdown(outputPath);
}

export function stagePptSourceOriginal(
	inputPath: string,
	destinationPath: string,
) {
	const resolvedInput = resolve(inputPath);
	assertInsideUploadRoot(resolvedInput);
	if (!existsSync(resolvedInput) || !statSync(resolvedInput).isFile()) {
		throw new Error("上传文档不存在，请重新上传。");
	}
	mkdirSync(dirname(destinationPath), { recursive: true });
	copyFileSync(resolvedInput, destinationPath);
	return destinationPath;
}

export async function runPptxSourceIntake(
	stagedSourcePath: string,
	analysisDir: string,
) {
	if (!PPTX_SOURCE_EXTENSIONS.has(extname(stagedSourcePath).toLowerCase())) {
		return false;
	}
	mkdirSync(analysisDir, { recursive: true });
	const scriptPath = resolve(
		getPptMasterSkillDir(),
		"scripts",
		"pptx_intake.py",
	);
	await executePython(scriptPath, [stagedSourcePath, "-o", analysisDir], 300_000);
	return true;
}

export function collectConvertedSourceImages(
	markdownPath: string,
	imagesDir: string,
	prefix: string,
) {
	const assetDir = join(dirname(markdownPath), `${basename(markdownPath, extname(markdownPath))}_files`);
	if (!existsSync(assetDir) || !statSync(assetDir).isDirectory()) return [];
	mkdirSync(imagesDir, { recursive: true });
	const copied: string[] = [];
	for (const sourcePath of listFilesRecursively(assetDir)) {
		const extension = extname(sourcePath).toLowerCase();
		if (!SOURCE_IMAGE_EXTENSIONS.has(extension)) continue;
		const safeBase = basename(sourcePath)
			.replace(/[^A-Za-z0-9._-]+/g, "_")
			.replace(/^\.+/, "") || `image${extension}`;
		let destination = join(imagesDir, `${prefix}_${safeBase}`);
		let sequence = 2;
		while (existsSync(destination)) {
			destination = join(
				imagesDir,
				`${prefix}_${basename(safeBase, extension)}_${sequence}${extension}`,
			);
			sequence += 1;
		}
		copyFileSync(sourcePath, destination);
		copied.push(destination);
	}
	return copied;
}

export async function analyzePptSourceImages(imagesDir: string) {
	if (
		!existsSync(imagesDir) ||
		!readdirSync(imagesDir).some((file) =>
			SOURCE_IMAGE_EXTENSIONS.has(extname(file).toLowerCase()),
		)
	) {
		return false;
	}
	const scriptPath = resolve(
		getPptMasterSkillDir(),
		"scripts",
		"analyze_images.py",
	);
	await executePython(scriptPath, [imagesDir], 180_000);
	return true;
}

export function readConvertedMarkdown(outputPath: string) {
	if (!existsSync(outputPath)) throw new Error("文档转换后没有可用内容。");
	const info = statSync(outputPath);
	if (!info.isFile()) throw new Error("文档转换后没有可用内容。");
	if (info.size > MAX_CONVERTED_MARKDOWN_BYTES) {
		rmSync(outputPath, { force: true });
		throw new Error("文档转换后的文字内容过多，请精简资料后重试。");
	}
	const text = readFileSync(outputPath, "utf-8").trim();
	if (!text) throw new Error("文档转换后没有可用内容。");
	return text;
}

async function executePython(
	scriptPath: string,
	args: string[],
	timeoutMs: number,
) {
	const result = await runBoundedProcess(
		getPptPythonCommand(),
		[scriptPath, ...args],
		{
			timeoutMs,
			spawnOptions: {
			cwd: getPptMasterSkillDir(),
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			},
			timeoutError: () => new Error(`文档转换超时：${scriptPath}`),
			outputLimitError: () => new Error("文档转换输出异常，已停止处理。"),
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			`文档转换失败：${(result.stderr || result.stdout).slice(0, 4000)}`,
		);
	}
}

function listFilesRecursively(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isSymbolicLink()) return [];
		if (entry.isDirectory()) return listFilesRecursively(path);
		return entry.isFile() ? [path] : [];
	});
}
