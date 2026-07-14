import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";
import { runBoundedProcess } from "./bounded-process";
import type { ToolDefinition } from "@/lib/providers/text-openai";

const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";
const MAX_TOOL_WRITE_CHARS = 2_000_000;
const MAX_TOOL_WRITE_BYTES = 4 * 1024 * 1024;
const ALLOWED_SCRIPT_NAMES = new Set([
	"analyze_images.py",
	"animation_config.py",
	"svg_quality_checker.py",
	"image_gen.py",
	"image_search.py",
	"latex_render.py",
	"notes_to_audio.py",
	"total_md_split.py",
	"finalize_svg.py",
	"svg_to_pptx.py",
	"visual_review.py",
]);

const ALLOWED_SCRIPT_OPTIONS: Record<string, Set<string>> = {
	"analyze_images.py": new Set(["--output", "-o"]),
	"animation_config.py": new Set([
		"scaffold",
		"list-groups",
		"validate",
		"--force",
		"--output",
		"-o",
		"--config",
		"-c",
	]),
	"finalize_svg.py": new Set([
		"--only",
		"--dry-run",
		"-n",
		"--quiet",
		"-q",
		"--compress",
		"--max-dimension",
	]),
	"image_gen.py": new Set([
		"--manifest",
		"--render-md",
		"--output",
		"-o",
		"--concurrency",
		"--backend",
		"--model",
		"--image-size",
	]),
	"image_search.py": new Set([
		"--manifest",
		"--filename",
		"--output",
		"-o",
		"--orientation",
		"--provider",
		"--purpose",
		"--slide",
		"--strict-no-attribution",
		"--min-width",
		"--min-height",
		"--no-candidates",
		"--max-candidates",
	]),
	"latex_render.py": new Set([
		"--manifest",
		"--providers",
		"--output-dir",
		"--timeout",
	]),
	"notes_to_audio.py": new Set([
		"--output",
		"-o",
		"--provider",
		"--voice",
		"--voice-id",
		"--rate",
		"--list-common-voices",
		"--locale",
	]),
	"svg_quality_checker.py": new Set(["--format"]),
	"svg_to_pptx.py": new Set([
		"--source",
		"-s",
		"--animation",
		"-a",
		"--animation-trigger",
		"--animation-config",
		"--animation-stagger",
		"--auto-advance",
		"--svg-snapshot",
	]),
	"total_md_split.py": new Set([]),
	"visual_review.py": new Set(["--output", "-o", "--source", "-s", "--format"]),
};

const ALLOWED_FREE_VALUE_OPTIONS: Record<string, Set<string>> = {
	"image_gen.py": new Set([
		"--concurrency",
		"--backend",
		"--model",
		"--image-size",
	]),
	"image_search.py": new Set([
		"--filename",
		"--orientation",
		"--provider",
		"--purpose",
		"--slide",
		"--min-width",
		"--min-height",
		"--max-candidates",
	]),
	"latex_render.py": new Set(["--providers", "--timeout"]),
	"notes_to_audio.py": new Set([
		"--provider",
		"--voice",
		"--voice-id",
		"--rate",
		"--locale",
	]),
	"svg_quality_checker.py": new Set(["--format"]),
	"svg_to_pptx.py": new Set([
		"--animation",
		"-a",
		"--animation-trigger",
		"--animation-stagger",
		"--auto-advance",
	]),
	"visual_review.py": new Set(["--source", "-s", "--format"]),
};

const ALLOWED_PROJECT_PATH_OPTIONS: Record<string, Set<string>> = {
	"analyze_images.py": new Set(["--output", "-o"]),
	"animation_config.py": new Set(["--output", "-o", "--config", "-c"]),
	"image_gen.py": new Set(["--manifest", "--render-md", "--output", "-o"]),
	"image_search.py": new Set(["--manifest", "--output", "-o"]),
	"latex_render.py": new Set(["--manifest", "--output-dir"]),
	"notes_to_audio.py": new Set(["--output", "-o"]),
	"svg_to_pptx.py": new Set(["--animation-config"]),
	"visual_review.py": new Set(["--output", "-o"]),
};

const ALLOWED_SUBCOMMANDS: Record<string, Set<string>> = {
	"animation_config.py": new Set(["scaffold", "list-groups", "validate"]),
	"finalize_svg.py": new Set([
		"embed-icons",
		"align-images",
		"flatten-text",
		"fix-rounded",
	]),
};

export const PPT_AGENT_TOOLS: ToolDefinition[] = [
	{
		type: "function",
		function: {
			name: "read_file",
			description:
				"Read a UTF-8 text file from the current PPT project or ppt-master skill directory.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "write_file",
			description:
				"Write a UTF-8 file under the current PPT project directory.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					content: { type: "string" },
				},
				required: ["path", "content"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "list_dir",
			description:
				"List files under the current PPT project or ppt-master skill directory.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "quality_check",
			description:
				"Run the PPT Master SVG quality checker on the current project.",
			parameters: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
		},
	},
	{
		type: "function",
		function: {
			name: "run_ppt_script",
			description:
				"Run a whitelisted ppt-master Python script against the current project.",
			parameters: {
				type: "object",
				properties: {
					script: { type: "string", enum: Array.from(ALLOWED_SCRIPT_NAMES) },
					args: { type: "array", items: { type: "string" } },
				},
				required: ["script"],
				additionalProperties: false,
			},
		},
	},
];

export class PptToolRuntime {
	private readonly projectDir: string;
	private readonly skillDir: string;
	private readonly signal?: AbortSignal;
	private readonly templateBaseReads = new Set<number>();

	constructor(projectDir: string, signal?: AbortSignal) {
		this.projectDir = resolve(projectDir);
		this.skillDir = resolve(getPptMasterSkillDir());
		this.signal = signal;
	}

	async execute(name: string, rawArgs: string) {
		const args = parseToolArgs(rawArgs);
		if (name === "read_file")
			return this.readFile(requireString(args.path, "path"));
		if (name === "write_file")
			return this.writeFile(
				requireString(args.path, "path"),
				requireString(args.content, "content"),
			);
		if (name === "list_dir")
			return this.listDir(requireString(args.path, "path"));
		if (name === "quality_check")
			return this.runPptScript("svg_quality_checker.py", [this.projectDir]);
		if (name === "run_ppt_script") {
			const script = requireString(args.script, "script");
			const scriptArgs = Array.isArray(args.args) ? args.args.map(String) : [];
			return this.runPptScript(script, scriptArgs);
		}
		throw new Error(`Unsupported PPT tool: ${name}`);
	}

	readFile(path: string) {
		const resolved = this.resolveReadablePath(path);
		if (!existsSync(resolved)) throw new Error(`File not found: ${path}`);
		const info = statSync(resolved);
		if (!info.isFile()) throw new Error(`Not a file: ${path}`);
		if (info.size > 600_000)
			throw new Error(`File too large to read through tool: ${path}`);
		this.recordTemplateBaseRead(path);
		return readFileSync(resolved, "utf-8");
	}

	writeFile(path: string, content: string) {
		if (
			content.length > MAX_TOOL_WRITE_CHARS ||
			Buffer.byteLength(content, "utf-8") > MAX_TOOL_WRITE_BYTES
		) {
			throw new Error(`File too large to write through tool: ${path}`);
		}
		this.assertTemplateBaseReadBeforeSlideWrite(path);
		const resolved = this.resolveProjectPath(path);
		mkdirSync(dirname(resolved), { recursive: true });
		writeFileSync(resolved, content, "utf-8");
		return `File written: ${this.relativeToProject(resolved)} (${content.length} chars)`;
	}

	listDir(path: string) {
		const resolved = this.resolveReadablePath(path);
		if (!existsSync(resolved)) throw new Error(`Directory not found: ${path}`);
		const info = statSync(resolved);
		if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`);
		return readdirSync(resolved)
			.slice(0, 200)
			.map((name) => {
				const item = join(resolved, name);
				const stat = statSync(item);
				return `${stat.isDirectory() ? "dir " : "file"} ${name}${stat.isFile() ? ` ${stat.size}B` : ""}`;
			})
			.join("\n");
	}

	async runPptScript(script: string, args: string[]) {
		if (!ALLOWED_SCRIPT_NAMES.has(script)) {
			throw new Error(`Script is not allowed: ${script}`);
		}
		const scriptPath = join(this.skillDir, "scripts", script);
		if (!existsSync(scriptPath))
			throw new Error(`PPT script not found: ${script}`);
		const safeArgs = args.map((arg, index) =>
			this.resolveScriptArg(script, arg, args[index - 1]),
		);
		if (safeArgs.length === 0) safeArgs.push(this.projectDir);
		return executePython(scriptPath, safeArgs, this.signal);
	}

	private resolveScriptArg(script: string, arg: string, previousArg?: string) {
		if (arg === "{projectDir}") return this.projectDir;
		if (arg.startsWith("-")) return this.resolveScriptOption(script, arg);
		if (ALLOWED_SUBCOMMANDS[script]?.has(arg)) return arg;
		if (previousArg === "-s" || previousArg === "--source") {
			if (
				arg === "output" ||
				arg === "final" ||
				arg === "svg_output" ||
				arg === "svg_final"
			)
				return arg;
			throw new Error(`Unsupported PPT script source argument: ${arg}`);
		}
		if (this.isProjectPathOption(script, previousArg))
			return this.resolveProjectPath(arg);
		if (this.isFreeValueOption(script, previousArg)) return arg;
		if (script === "image_search.py" && !previousArg) return arg.slice(0, 160);
		return this.resolveProjectPath(arg);
	}

	private resolveScriptOption(script: string, option: string) {
		const allowed = ALLOWED_SCRIPT_OPTIONS[script] || new Set<string>();
		if (!allowed.has(option))
			throw new Error(`Unsupported option for ${script}: ${option}`);
		return option;
	}

	private isFreeValueOption(script: string, previousArg?: string) {
		if (!previousArg) return false;
		return Boolean(ALLOWED_FREE_VALUE_OPTIONS[script]?.has(previousArg));
	}

	private isProjectPathOption(script: string, previousArg?: string) {
		if (!previousArg) return false;
		return Boolean(ALLOWED_PROJECT_PATH_OPTIONS[script]?.has(previousArg));
	}

	private resolveReadablePath(path: string) {
		const resolved = resolve(this.projectDir, path);
		if (isInside(resolved, this.projectDir) && existsSync(resolved))
			return resolved;
		const skillRelative = resolve(this.skillDir, path);
		if (isInside(skillRelative, this.skillDir) && existsSync(skillRelative))
			return skillRelative;
		if (isInside(resolved, this.projectDir)) return resolved;
		if (isInside(resolved, this.skillDir)) return resolved;
		throw new Error(`Path is outside allowed PPT directories: ${path}`);
	}

	private resolveProjectPath(path: string) {
		const resolved = resolve(this.projectDir, path);
		if (!isInside(resolved, this.projectDir)) {
			throw new Error(`Path is outside the PPT project directory: ${path}`);
		}
		return resolved;
	}

	private relativeToProject(path: string) {
		return relative(this.projectDir, path).replaceAll("\\", "/");
	}

	private recordTemplateBaseRead(path: string) {
		const normalized = path.replaceAll("\\", "/");
		const match = normalized.match(
			/(?:^|\/)template_refs\/target_(\d{2})_[^/]+\.svg$/i,
		);
		if (match?.[1]) {
			this.templateBaseReads.add(Number(match[1]));
		}
	}

	private assertTemplateBaseReadBeforeSlideWrite(path: string) {
		const normalized = path.replaceAll("\\", "/");
		const match = normalized.match(/(?:^|\/)svg_output\/(\d{2})_slide\.svg$/i);
		if (
			!match?.[1] ||
			!existsSync(join(this.projectDir, "template_refs", "template-map.md"))
		)
			return;
		const slideNo = Number(match[1]);
		if (this.templateBaseReads.has(slideNo)) return;
		throw new Error(
			`外部模板已启用。写入 ${normalized} 前必须先 read_file 对应 template_refs/target_${String(slideNo).padStart(2, "0")}_*.svg，并在该底稿结构上改写内容。`,
		);
	}
}

function parseToolArgs(rawArgs: string) {
	try {
		const value = JSON.parse(rawArgs || "{}");
		if (value && typeof value === "object")
			return value as Record<string, unknown>;
	} catch {
		// handled below
	}
	throw new Error("Tool arguments must be a JSON object");
}

function requireString(value: unknown, name: string) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`Missing tool argument: ${name}`);
	return value;
}

function isInside(path: string, root: string) {
	const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
	return path === root || path.startsWith(normalizedRoot);
}

async function executePython(
	scriptPath: string,
	args: string[],
	signal?: AbortSignal,
) {
	const result = await runBoundedProcess(PYTHON_CMD, [scriptPath, ...args], {
		timeoutMs: 300_000,
		signal,
		spawnOptions: {
			cwd: getPptMasterSkillDir(),
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
		},
		timeoutError: () => new Error(`PPT script timed out: ${scriptPath}`),
		abortError: (reason) =>
			reason instanceof Error
				? reason
				: new Error("PPT generation was cancelled"),
		outputLimitError: () =>
			new Error(`PPT script produced too much output: ${scriptPath}`),
	});
	if (result.exitCode === 0) {
		return (result.stdout || result.stderr || "OK").slice(0, 10_000);
	}
	throw new Error(
		`PPT script exited with ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 4000)}`,
	);
}
