import { existsSync, readFileSync, rmSync, statSync } from "fs";
import { mkdir } from "fs/promises";
import { dirname, extname, resolve } from "path";
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
