import { spawn } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";

const PYTHON_CMD =
	process.env.PPT_PYTHON_CMD?.trim() ||
	(process.platform === "win32" ? "python" : "python3");
let pythonRuntimeCheck: Promise<void> | undefined;

export function getPptPythonCommand() {
	return PYTHON_CMD;
}

export function assertPptPythonRuntime() {
	pythonRuntimeCheck ??= new Promise<void>((resolvePromise, reject) => {
		const proc = spawn(
			PYTHON_CMD,
			[
				"-c",
				"import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
			],
			{ windowsHide: true },
		);
		let output = "";
		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`PPT Python 版本检查超时：${PYTHON_CMD}`));
		}, 10_000);
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.on("error", () => {
			clearTimeout(timer);
			reject(
				new Error(
					`PPT Master 需要 Python 3.10+，当前命令不可用：${PYTHON_CMD}。请配置 PPT_PYTHON_CMD。`,
				),
			);
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			const [major, minor] = output.trim().split(".").map(Number);
			if (code === 0 && (major > 3 || (major === 3 && minor >= 10))) {
				resolvePromise();
				return;
			}
			reject(
				new Error(
					`PPT Master v3.1.0 需要 Python 3.10+，${PYTHON_CMD} 当前为 ${output.trim() || "未知版本"}。请配置 PPT_PYTHON_CMD。`,
				),
			);
		});
	});
	return pythonRuntimeCheck;
}

function getSkillDir(skillDir?: string) {
	return skillDir || getPptMasterSkillDir();
}

function getScriptsDir(skillDir?: string) {
	return join(getSkillDir(skillDir), "scripts");
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

	return new Promise((resolvePromise, reject) => {
		const proc = spawn(PYTHON_CMD, [scriptPath, ...args], {
			cwd: getSkillDir(skillDir),
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
		});

		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`Python script timed out: ${scriptPath}`));
		}, timeoutMs);

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		proc.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolvePromise({ stdout, stderr, exitCode: code });
				return;
			}
			reject(
				new Error(
					`Python script failed with code ${code}: ${stderr || stdout}`,
				),
			);
		});

		proc.on("error", (error) => {
			clearTimeout(timer);
			reject(new Error(`Failed to spawn Python: ${error.message}`));
		});
	});
}

export function getPptScriptPath(name: string, skillDir?: string) {
	return join(getScriptsDir(skillDir), name);
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

export async function convertUrlToMarkdown(url: string): Promise<string> {
	const script = join(getScriptsDir(), "source_to_md", "web_to_md.py");
	const result = await executePptPython(script, [url], 120_000);
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
		const errors = result.stdout.match(/ERROR:.*$/gm) || [];
		const warnings = result.stdout.match(/WARNING:.*$/gm) || [];
		return {
			errors: errors.map((item) => item.replace(/^ERROR:\s*/, "")),
			warnings: warnings.map((item) => item.replace(/^WARNING:\s*/, "")),
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
