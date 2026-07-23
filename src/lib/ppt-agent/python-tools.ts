import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";
import { runBoundedProcess } from "./bounded-process";
import { isPptFontSafetyWarning } from "./font-safety";
import { findSvgTextLayoutIssues } from "./svg-layout-analyze";
import { findConfirmedPptPageTitleIssues } from "./confirmed-output";

const PYTHON_CMD =
	process.env.PPT_PYTHON_CMD?.trim() ||
	(process.platform === "win32" ? "python" : "python3");
let pythonRuntimeCheck: Promise<void> | undefined;

export function getPptPythonCommand() {
	return PYTHON_CMD;
}

export function assertPptPythonRuntime() {
	pythonRuntimeCheck ??= runBoundedProcess(
		/* turbopackIgnore: true */ PYTHON_CMD,
		[
			"-c",
			"import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
		],
		{
			timeoutMs: 10_000,
			maxOutputBytes: 16 * 1024,
			spawnOptions: { windowsHide: true },
			timeoutError: () =>
				new Error(`PPT Python 版本检查超时：${PYTHON_CMD}`),
			outputLimitError: () =>
				new Error(`PPT Python 版本检查输出异常：${PYTHON_CMD}`),
			spawnError: () =>
				new Error(
					`PPT Master 需要 Python 3.10+，当前命令不可用：${PYTHON_CMD}。请配置 PPT_PYTHON_CMD。`,
				),
		},
	).then((result) => {
		const output = result.stdout.trim();
		const [major, minor] = output.split(".").map(Number);
		if (
			result.exitCode === 0 &&
			(major > 3 || (major === 3 && minor >= 10))
		) {
			return;
		}
		throw new Error(
			`PPT Master v3.1.0 需要 Python 3.10+，${PYTHON_CMD} 当前为 ${output || "未知版本"}。请配置 PPT_PYTHON_CMD。`,
		);
	});
	return pythonRuntimeCheck;
}

function getSkillDir(skillDir?: string) {
	return skillDir || getPptMasterSkillDir();
}

function getScriptsDir(skillDir?: string) {
	return join(/* turbopackIgnore: true */ getSkillDir(skillDir), "scripts");
}

export interface PythonResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function executePptPython(
	scriptPath: string,
	args: string[],
	timeoutMs = 180_000,
	skillDir?: string,
): Promise<PythonResult> {
	if (!existsSync(scriptPath)) {
		throw new Error(`PPT Master script not found: ${scriptPath}`);
	}

	const result = await runBoundedProcess(
		/* turbopackIgnore: true */ PYTHON_CMD,
		[scriptPath, ...args],
		{
			timeoutMs,
			spawnOptions: {
				cwd: getSkillDir(skillDir),
				windowsHide: true,
				env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			},
			timeoutError: () => new Error(`Python script timed out: ${scriptPath}`),
			outputLimitError: () =>
				new Error(`Python script produced too much output: ${scriptPath}`),
			spawnError: (error) =>
				new Error(`Failed to spawn Python: ${error.message}`),
		},
	);
	if (result.exitCode === 0) {
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
		};
	}
	throw new Error(
		`Python script failed with code ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 4_000)}`,
	);
}

export function getPptScriptPath(name: string, skillDir?: string) {
	return join(/* turbopackIgnore: true */ getScriptsDir(skillDir), name);
}

export async function convertPdfToMarkdown(pdfPath: string): Promise<string> {
	const script = join(getScriptsDir(), "source_to_md", "pdf_to_md.py");
	const result = await executePptPython(script, [pdfPath]);
	return result.stdout;
}

export async function convertDocxToMarkdown(docxPath: string): Promise<string> {
	const script = join(getScriptsDir(), "source_to_md", "doc_to_md.py");
	const result = await executePptPython(script, [docxPath]);
	return result.stdout;
}

export async function convertSvgToPptx(
	projectPath: string,
	skillDir?: string,
): Promise<string> {
	const script = join(getScriptsDir(skillDir), "svg_to_pptx.py");
	const result = await executePptPython(
		script,
		buildPptxExportArgs(projectPath),
		300_000,
		skillDir,
	);
	const match = result.stdout.match(/exports[\\/][^\r\n]+\.pptx/i);
	if (!match) {
		throw new Error("PPTX path not found in svg_to_pptx output");
	}
	return join(projectPath, match[0]);
}

export async function splitNotes(
	projectPath: string,
	skillDir?: string,
): Promise<void> {
	const script = join(getScriptsDir(skillDir), "total_md_split.py");
	await executePptPython(script, [projectPath], 180_000, skillDir);
}

export async function finalizeSvg(
	projectPath: string,
	skillDir?: string,
): Promise<void> {
	const script = join(getScriptsDir(skillDir), "finalize_svg.py");
	await executePptPython(script, [projectPath], 300_000, skillDir);
}

export async function checkSvgQuality(
	projectPath: string,
	skillDir?: string,
): Promise<{ errors: string[]; warnings: string[] }> {
	const script = join(getScriptsDir(skillDir), "svg_quality_checker.py");
	try {
		const result = await executePptPython(
			script,
			[projectPath],
			180_000,
			skillDir,
		);
		const normalizedErrors = parsePptSvgQualityMessages(
			result.stdout,
			"error",
		);
		const normalizedWarnings = parsePptSvgQualityMessages(
			result.stdout,
			"warning",
		);
		return {
			errors: [
				...normalizedErrors,
				...normalizedWarnings
					.filter(isPptFontSafetyWarning)
					.map((warning) => `PowerPoint 字体兼容性错误：${warning}`),
				...findProjectSvgTextLayoutIssues(projectPath),
				...findConfirmedPptPageTitleIssues(projectPath),
			],
			warnings: normalizedWarnings,
		};
	} catch (error) {
		return {
			errors: [
				error instanceof Error ? error.message : "SVG quality check failed",
			],
			warnings: [],
		};
	}
}

export function parsePptSvgQualityMessages(
	output: string,
	level: "error" | "warning",
) {
	const marker = level === "error" ? "ERROR" : "WARN(?:ING)?";
	const pattern = new RegExp(
		`^\\s*(?:\\[${marker}\\]|${marker}:)\\s*(.+)$`,
		"i",
	);
	const summary = level === "error" ? /^with errors:/i : /^with warnings:/i;
	return output
		.split(/\r?\n/)
		.flatMap((line) => {
			const message = line.match(pattern)?.[1]?.trim();
			return message && !summary.test(message) ? [message] : [];
		});
}

export function findProjectSvgTextLayoutIssues(projectPath: string) {
	const svgDir = join(projectPath, "svg_output");
	if (!existsSync(svgDir)) return [];
	const issues: string[] = [];
	for (const file of readdirSync(svgDir)
		.filter((item) => item.toLowerCase().endsWith(".svg"))
		.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }))) {
		const svg = readFileSync(join(svgDir, file), "utf-8");
		for (const issue of findSvgTextLayoutIssues(svg)) {
			issues.push(`${file}：${issue}`);
			if (issues.length >= 20) return issues;
		}
	}
	return issues;
}

function buildPptxExportArgs(projectPath: string) {
	const args = [projectPath];
	const animationConfig = join(projectPath, "animations.json");
	const audioDir = join(projectPath, "audio");

	if (existsSync(animationConfig)) {
		args.push("--animation-config", animationConfig);
	}
	if (hasNarrationAudio(audioDir)) {
		args.push("--recorded-narration", audioDir, "--use-narration-timings");
	}

	return args;
}

function hasNarrationAudio(audioDir: string) {
	if (!existsSync(audioDir)) return false;
	return readdirSync(audioDir).some((file) =>
		[".mp3", ".m4a", ".wav"].some((ext) => file.toLowerCase().endsWith(ext)),
	);
}
