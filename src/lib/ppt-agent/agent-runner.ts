import {
	spawn,
	type ChildProcessWithoutNullStreams,
	type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { findLatestPptx } from "./runner-utils";
import { onError } from "@/lib/logger";
import { emitProjectLog, updateProject } from "./project-log";
import {
	checkSvgQuality,
	convertSvgToPptx,
	finalizeSvg,
	splitNotes,
} from "./python-tools";
import { getPptMasterSkillDir } from "./runtime-paths";
import { getPptStyleLabel } from "./styles";
import { throwIfPptCancelled } from "./cancellation";
import {
	preparePptPiAgentConfig,
	type PreparedPiAgentConfig,
} from "./pi-agent-config";
import type { EventEmitter, GenerationParams } from "./generator";

export interface AgentRunResult {
	pptxPath: string;
	slideCount: number;
}

interface RunnerOptions {
	projectDir: string;
	sourceMd: string;
	slideCount: number;
	aspectRatio: "16:9" | "4:3";
	canvasFormat: "ppt169" | "ppt43";
	style: string;
	stylePrompt: string;
	styleLabel: string;
	signal?: AbortSignal;
	emit: EventEmitter;
}

interface AgentCommand {
	command: string;
	args: string[];
	cwd: string;
	stdin?: string;
	display: string;
	skillDir: string;
	piConfig: PreparedPiAgentConfig;
}

interface CommandResult {
	output: string;
	sessionId: string;
	stopReason: string;
	numTurns: number;
	resultText: string;
	errorMessage: string;
}

const DEFAULT_TIMEOUT_MS = 1000 * 60 * 60 * 2;
const MAX_AGENT_OUTPUT_TAIL_CHARS = 500_000;

export async function runPptMasterAgent(
	params: GenerationParams,
	options: RunnerOptions,
): Promise<AgentRunResult> {
	const livePreviewLockBefore = readLivePreviewLock(options.projectDir);
	try {
		return await runPptMasterAgentInner(params, options);
	} finally {
		stopProjectLivePreview(options.projectDir, livePreviewLockBefore);
	}
}

async function runPptMasterAgentInner(
	params: GenerationParams,
	options: RunnerOptions,
): Promise<AgentRunResult> {
	const sourceSkillDir = getPptMasterSkillDir();
	throwIfPptCancelled(options.signal);
	const skillFile = join(sourceSkillDir, "SKILL.md");
	if (!existsSync(skillFile)) {
		throw new Error(`PPT Master skill 缺少 SKILL.md：${skillFile}`);
	}
	const skillDir = prepareProjectSkillDir(options.projectDir, sourceSkillDir);
	const piConfig = await preparePptPiAgentConfig({
		projectId: params.projectId,
		userId: params.userId,
		projectDir: options.projectDir,
	});
	await emitProjectLog(
		params.projectId,
		options.emit,
		`已准备项目专属 pi 配置：${piConfig.source === "user" ? "使用我的 API" : "平台配置"} / ${piConfig.model}`,
	);

	const promptPath = writeAgentPrompt(params, options, skillDir);
	const prompt = readFileSync(promptPath, "utf-8");
	const command = resolveAgentCommand(
		params.projectId,
		options.projectDir,
		skillDir,
		promptPath,
		prompt,
		undefined,
		piConfig,
	);

	await emitProjectLog(
		params.projectId,
		options.emit,
		`启动 PPT Master CLI agent：${command.display}`,
	);
	options.emit({
		type: "phase",
		data: { phase: "STRATEGIZING", progress: 12 },
	});
	await updateProject(params.projectId, {
		status: "STRATEGIZING",
		currentPhase: "PPT Master agent 正在规划与生成",
		progress: 12,
	});

	const maxTurns = resolveMaxTurns(options);
	await emitProjectLog(
		params.projectId,
		options.emit,
		`PPT Master agent 最大续跑轮次：${maxTurns}`,
	);

	let result = await runCommand(params.projectId, command, options, 1);
	for (let turn = 2; turn <= maxTurns && !hasPptx(options.projectDir); turn++) {
		throwIfPptCancelled(options.signal);
		const needsContinue = shouldContinueAgent(
			options.projectDir,
			result,
			options,
		);
		if (!needsContinue) break;
		const continuePrompt = buildContinuePrompt(
			options.projectDir,
			turn,
			options,
			result,
		);
		const continueCommand = resolveAgentCommand(
			params.projectId,
			options.projectDir,
			skillDir,
			promptPath,
			continuePrompt,
			result.sessionId,
			piConfig,
		);
		await emitProjectLog(
			params.projectId,
			options.emit,
			`agent 第 ${turn} 轮继续执行：${describeContinueState(options.projectDir, options)}`,
		);
		result = await runCommand(params.projectId, continueCommand, options, turn);
	}

	if (
		!hasPptx(options.projectDir) &&
		shouldContinueAgent(options.projectDir, result, options)
	) {
		const svgCount = countSvgSlides(options.projectDir);
		await emitProjectLog(
			params.projectId,
			options.emit,
			`agent 达到最大续跑轮次 ${maxTurns} 后仍未完成，当前 SVG ${svgCount}/${options.slideCount}。`,
		);
		if (svgCount < options.slideCount) {
			throw new Error(
				`PPT Master agent 未完成全部页面：已生成 ${svgCount}/${options.slideCount} 个 SVG。最后一轮 stop_reason=${
					result.stopReason || "unknown"
				}。请提高 PPT_AGENT_MAX_TURNS 或减少页数后重试。`,
			);
		}
	}

	options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 90 } });
	throwIfPptCancelled(options.signal);
	await updateProject(params.projectId, {
		status: "EXPORTING",
		currentPhase: "校验并收集 PPTX 输出",
		progress: 90,
	});

	await verifyAgentOutputWithSkill(params.projectId, options, skillDir);

	let pptxPath = findLatestPptx(options.projectDir);
	if (!pptxPath && countSvgSlides(options.projectDir) > 0) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			"agent 已生成 SVG，服务器接管 Step 7 导出 PPTX",
		);
		await runServerSideExport(options.projectDir, skillDir);
		pptxPath = findLatestPptx(options.projectDir);
	}
	if (!pptxPath) {
		throw new Error(
			"PPT Master agent 已结束，但没有在 exports/ 下生成 PPTX。请查看项目日志和 agent-output.log。",
		);
	}

	return {
		pptxPath,
		slideCount: countSvgSlides(options.projectDir) || options.slideCount,
	};
}

function writeAgentPrompt(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
) {
	const promptPath = join(options.projectDir, "agent-task.md");
	const sourcePath = join(options.projectDir, "sources", "source.md");
	const output = [
		"# PPT Master Server Task",
		"",
		"你是服务器内置的 PPT Master 执行 agent。必须按项目内 PPT Master skill 私有副本的完整流程执行，不能退回为普通一次性 prompt 生成。",
		"",
		"## Hard Requirements",
		"",
		"- 先完整阅读 PPT Master skill 文件，再执行工作流。",
		"- 本任务的用户输入已经在站内表单确认过。下面的 `USER CONFIRMS` 行就是 Step 4 Blocking Gate 的显式用户确认；不要再向用户请求确认。",
		"- 如果 workflow 文档要求输出 Eight Confirmations，请把它们写入 `design_spec.md` 的 planning context 或日志，然后继续执行。不要把“请确认”作为最终回答。",
		"- 所有可见幻灯片文字必须使用简体中文。只有 AI、API、LLM、SaaS、PPTX 等无法自然翻译的产品名或技术缩写可以保留英文。",
		"- 使用真实项目文件作为上下文，逐页顺序生成 SVG。不要写脚本批量生成 SVG，不要只生成占位页。",
		"- 每页 SVG 生成前必须重新读取 `spec_lock.md`。",
		"- 如果存在 `template_refs/template-map.md`，必须采用模板底稿优先工作流：先读取 `template_refs/template-map.md`，每页生成前读取对应 `template_refs/target_XX_from_slide_YY.svg`，在该 SVG 结构上替换内容并保留模板版式骨架、背景、主装饰、卡片、阴影、页眉页脚和空间比例；禁止只提取颜色后从空白页重画。",
		"- 质量检查必须通过；如果 `svg_quality_checker.py` 报 error，修复后重跑。",
		"- 最后必须按 Step 7 依次运行 `total_md_split.py`、`finalize_svg.py`、`svg_to_pptx.py`，并在 `exports/` 下生成可编辑 PPTX。",
		"- 不要修改项目目录以外的任何文件。只允许写入当前 PPT 项目目录。",
		"- 如果需要临时修复 PPT Master 工具脚本，只能修改 `Project path` 下的 `.ppt-master-skill/` 私有副本，禁止编辑仓库源码的 `scripts/ppt-master/`。",
		"- Hosted-mode override: 本站前端会直接预览 `svg_output/`，不要启动长期运行的 `svg_editor/server.py` live preview 服务；这一步视为由站内 SSE 预览替代。",
		"- 如果缺少 API key、依赖或 agent 权限，明确写入失败原因，不要生成假文件。",
		"",
		"## Paths",
		"",
		`- PPT Master skill private copy: ${skillDir}`,
		`- Project path: ${options.projectDir}`,
		`- Source markdown: ${sourcePath}`,
		"",
		"## Confirmed Parameters",
		"",
		"USER CONFIRMS: I approve the eight confirmations and continuous mode. Continue all remaining steps now without asking another question.",
		`- Canvas: ${options.aspectRatio} (${options.canvasFormat})`,
		`- Target slide count: ${options.slideCount}`,
		`- Style: ${options.styleLabel || styleLabel(options.style)}`,
		`- Template hint/path: ${params.template || "(none, free design)"}`,
		"- Output language: Simplified Chinese for all visible slide text",
		"- Image usage: use placeholders or generated/web images only when the skill workflow and available environment support them; never block final PPTX solely because an optional image is unavailable.",
		"",
		"## Style Requirements",
		"",
		options.stylePrompt,
		"",
		"## Source Content",
		"",
		"Read `sources/source.md` for the concrete content. It currently contains:",
		"",
		"```markdown",
		options.sourceMd,
		"```",
		"",
		"## Completion Signal",
		"",
		"When finished, print a concise final line containing the generated PPTX path.",
		"",
	].join("\n");

	writeFileSync(promptPath, output, "utf-8");
	return promptPath;
}

function resolveAgentCommand(
	projectId: string,
	projectDir: string,
	skillDir: string,
	promptPath: string,
	prompt: string,
	resumeSessionId?: string,
	piConfig?: PreparedPiAgentConfig,
): AgentCommand {
	void promptPath;
	if (!piConfig) {
		throw new Error("PPT pi agent 配置未准备。");
	}
	const sessionId = sanitizeAgentSessionId(resumeSessionId || projectId);
	const sessionDir = join(projectDir, ".pi-sessions");
	mkdirSync(sessionDir, { recursive: true });
	const tools = resolvePiTools();
	const args = [
		"-p",
		"--mode",
		"json",
		"--approve",
		"--provider",
		piConfig.provider,
		"--model",
		piConfig.model,
		"--thinking",
		resolvePiThinkingLevel(),
		"--skill",
		skillDir,
		"--tools",
		tools,
		"--session-dir",
		sessionDir,
		"--session-id",
		sessionId,
	];
	return {
		command: "pi",
		args,
		cwd: projectDir,
		stdin: prompt,
		display: `pi -p --mode json --provider ${piConfig.provider} --model ${piConfig.model} --skill <ppt-master> --session-id ${sessionId} <agent-task.md>`,
		skillDir,
		piConfig,
	};
}

function buildContinuePrompt(
	projectDir: string,
	turn: number,
	options: RunnerOptions,
	previous: CommandResult,
) {
	const svgCount = countSvgSlides(projectDir);
	const nextSlide = Math.min(svgCount + 1, options.slideCount);
	const interruptedByToolUse = previous.stopReason === "tool_use";

	if (svgCount >= options.slideCount) {
		return [
			"确认继续。当前目标页数的 SVG 页面已经生成，请不要重新开始，也不要重写已有 SVG。",
			"继续执行 PPT Master Step 7：质量检查、notes/total.md、total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
			"必须在 exports/ 下生成可编辑 PPTX。完成前不要停止或请求确认。",
		].join("\n");
	}

	if (svgCount > 0) {
		return [
			"确认继续。不要重新开始，不要重写已有 SVG。",
			`当前 svg_output/ 已有 ${svgCount}/${options.slideCount} 页。请从第 ${nextSlide} 页继续逐页生成，直到第 ${options.slideCount} 页全部完成。`,
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
			interruptedByToolUse
				? "上一轮停在工具调用边界；如果上一条工具写入没有落盘，请重新发起对应写入或 Bash 工具调用。"
				: "",
			"完成前不要停止，不要请求确认。",
		]
			.filter(Boolean)
			.join("\n");
	}

	const hasSpecLock = existsSync(join(projectDir, "spec_lock.md"));
	if (hasSpecLock) {
		return [
			"确认继续。design_spec.md 和 spec_lock.md 已经存在，请不要重新规划，不要重写这两个文件。",
			`当前还没有 SVG 落盘。请从第 1 页开始，逐页生成 svg_output/*.svg，目标页数 ${options.slideCount}。`,
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
			interruptedByToolUse
				? "上一轮停在未完成的工具调用边界；请先完成或重做上一条 SVG Write 工具调用。"
				: "",
			"完成前不要停止，不要请求确认。",
		]
			.filter(Boolean)
			.join("\n");
	}

	return [
		"我确认并批准上一轮 Eight Confirmations。",
		`这是服务器自动续跑第 ${turn} 轮，等价于用户明确回复“确认，继续”。`,
		"请立刻继续执行完整 PPT Master 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md，运行质量检查并修复，然后执行 total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
		"不要再输出确认问题。不要只输出计划。完成前不要停止。",
	].join("\n");
}

function prepareProjectSkillDir(projectDir: string, sourceSkillDir: string) {
	const targetDir = join(projectDir, ".ppt-master-skill");
	if (existsSync(targetDir)) {
		rmSync(targetDir, { recursive: true, force: true });
	}
	cpSync(sourceSkillDir, targetDir, {
		recursive: true,
		force: true,
		filter: (source) => !shouldSkipSkillCopy(source, sourceSkillDir),
	});
	return targetDir;
}

function shouldSkipSkillCopy(source: string, sourceSkillDir: string) {
	const relative = source.slice(sourceSkillDir.length).replace(/^[/\\]+/, "");
	if (!relative) return false;
	const parts = relative.split(/[/\\]+/);
	return parts.some(
		(part) =>
			part === "__pycache__" ||
			part === ".DS_Store" ||
			part === ".git" ||
			part.endsWith(".pyc"),
	);
}


function sanitizeAgentSessionId(value: string) {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
	return sanitized || `ppt-${Date.now()}`;
}

function resolvePiTools() {
	const configured =
		process.env.PPT_PI_AGENT_TOOLS?.trim() ||
		process.env.PPT_AGENT_TOOLS?.trim() ||
		"";
	if (!configured) return "read,write,bash,grep,find,ls";

	const aliases: Record<string, string> = {
		read: "read",
		write: "write",
		edit: "edit",
		bash: "bash",
		grep: "grep",
		find: "find",
		ls: "ls",
		glob: "find",
	};
	const tools = configured
		.split(",")
		.map((tool) => aliases[tool.trim().toLowerCase()])
		.filter((tool): tool is string => Boolean(tool));
	return [...new Set(tools)].join(",") || "read,write,bash,grep,find,ls";
}

function resolvePiThinkingLevel() {
	return process.env.PPT_PI_THINKING?.trim() || "off";
}

function buildAgentPathEnv() {
	const pythonCmd = process.env.PPT_PYTHON_CMD?.trim();
	if (!pythonCmd || process.platform === "win32") return process.env.PATH;
	const pythonDir = dirname(pythonCmd);
	if (!pythonDir || pythonDir === ".") return process.env.PATH;
	return [pythonDir, process.env.PATH].filter(Boolean).join(":");
}

async function runCommand(
	projectId: string,
	command: AgentCommand,
	options: RunnerOptions,
	turn: number,
): Promise<CommandResult> {
	mkdirSync(options.projectDir, { recursive: true });
	throwIfPptCancelled(options.signal);
	const logPath = join(options.projectDir, "agent-output.log");
	const timeoutMs = Number(
		process.env.PPT_AGENT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
	);

	return new Promise<CommandResult>((resolvePromise, reject) => {
		const spawnTarget = resolveExecutable(command.command);
		const spawnArgs = buildSpawnArgs(spawnTarget, command.args);
		const proc: ChildProcessWithoutNullStreams = spawn(
			spawnArgs.command,
			spawnArgs.args,
			{
				cwd: command.cwd,
				windowsHide: true,
				env: {
					...process.env,
					PATH: buildAgentPathEnv(),
					PI_CODING_AGENT_DIR: command.piConfig.configDir,
					PPT_PI_PROVIDER: command.piConfig.provider,
					PPT_PI_MODEL: command.piConfig.model,
					PPT_MASTER_SKILL_DIR: command.skillDir,
					PYTHONIOENCODING: "utf-8",
				},
			} satisfies SpawnOptionsWithoutStdio,
		);

		let output = "";
		let settled = false;
		const startedAt = Date.now();
		appendFileSync(
			logPath,
			[
				"",
				`\n===== PPT Master agent turn ${turn} started ${new Date().toISOString()} =====`,
				`cwd: ${command.cwd}`,
				`command: ${command.display}`,
				"",
			].join("\n"),
			"utf-8",
		);

		const timer = setInterval(() => {
			const elapsed = Date.now() - startedAt;
			const progress = Math.min(
				88,
				12 + Math.floor((elapsed / timeoutMs) * 72),
			);
			options.emit({ type: "progress", data: { progress } });
			updateProject(projectId, { progress }).catch(
				onError("agent-runner", "更新进度失败"),
			);
			emitPreviews(projectId, options);
		}, 15_000);

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			clearInterval(timer);
			proc.kill();
			reject(
				new Error(
					`PPT Master agent 执行超时（${Math.round(timeoutMs / 60000)} 分钟）。`,
				),
			);
		}, timeoutMs);
		const abort = () => {
			if (settled) return;
			settled = true;
			clearInterval(timer);
			clearTimeout(timeout);
			proc.kill();
			reject(
				options.signal?.reason instanceof Error
					? options.signal.reason
					: new Error("用户已停止生成"),
			);
		};
		if (options.signal?.aborted) abort();
		options.signal?.addEventListener("abort", abort, { once: true });

		const processLine = (line: string) => {
			const message = normalizeAgentLine(line.trim());
			if (message) {
				appendFileSync(logPath, `${message}\n`, "utf-8");
				emitProjectLog(projectId, options.emit, message).catch(
					onError("agent-runner", "写入项目日志失败"),
				);
				updatePhaseFromLine(projectId, options, message).catch(
					onError("agent-runner", "更新阶段失败"),
				);
			}
		};
		let stdoutPending = "";
		let stderrPending = "";
		const onChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			output = (output + text).slice(-MAX_AGENT_OUTPUT_TAIL_CHARS);
			const pending = stream === "stdout" ? stdoutPending : stderrPending;
			const lines = (pending + text).split(/\r?\n/);
			const nextPending = lines.pop() || "";
			if (stream === "stdout") {
				stdoutPending = nextPending;
			} else {
				stderrPending = nextPending;
			}
			for (const line of lines) {
				if (line.trim()) processLine(line);
			}
		};
		const flushPendingLines = () => {
			for (const line of [stdoutPending, stderrPending]) {
				if (line.trim()) processLine(line);
			}
			stdoutPending = "";
			stderrPending = "";
		};

		proc.stdout.on("data", (chunk) => onChunk("stdout", chunk));
		proc.stderr.on("data", (chunk) => onChunk("stderr", chunk));

		if (command.stdin) {
			proc.stdin.write(command.stdin);
		}
		proc.stdin.end();

		proc.on("error", (error) => {
			options.signal?.removeEventListener("abort", abort);
			clearInterval(timer);
			clearTimeout(timeout);
			if (settled) return;
			settled = true;
			reject(new Error(`无法启动 PPT Master agent：${error.message}`));
		});

		proc.on("close", async (code) => {
			options.signal?.removeEventListener("abort", abort);
			clearInterval(timer);
			clearTimeout(timeout);
			if (settled) return;
			settled = true;
			flushPendingLines();
			emitPreviews(projectId, options);
				if (code === 0) {
					const metadata = extractResultMetadata(output);
					if (metadata.errorMessage) {
						await emitProjectLog(
							projectId,
							options.emit,
							`pi provider error: ${metadata.errorMessage}`,
						).catch(onError("agent-runner", "发出项目日志失败"));
						reject(
							new Error(`PPT Master agent 调用模型失败：${metadata.errorMessage}`),
						);
						return;
					}
					await emitProjectLog(
						projectId,
						options.emit,
						`agent 第 ${turn} 轮结束：stop_reason=${metadata.stopReason || "unknown"}，num_turns=${metadata.numTurns || 0}`,
				).catch(onError("agent-runner", "发出项目日志失败"));
				resolvePromise({ output, ...metadata });
				return;
			}
			if (canRecoverFromAgentExit(output, options.projectDir)) {
				await emitProjectLog(
					projectId,
					options.emit,
					"agent 在最后阶段退出，检测到可恢复输出，继续由服务器完成导出。",
				).catch(onError("agent-runner", "发出项目日志失败"));
				const metadata = extractResultMetadata(output);
				resolvePromise({ output, ...metadata });
				return;
			}
			const tail = output.split(/\r?\n/).filter(Boolean).slice(-12).join("\n");
			reject(new Error(`PPT Master agent 退出码 ${code}。\n${tail}`));
		});
	});
}

function resolveExecutable(command: string) {
	if (
		process.platform !== "win32" ||
		/[\\/]/.test(command) ||
		/\.[a-z0-9]+$/i.test(command)
	) {
		return command;
	}

	const candidates = (process.env.PATH || "")
		.split(";")
		.flatMap((dir) => [
			`${dir}\\${command}.cmd`,
			`${dir}\\${command}.exe`,
			`${dir}\\${command}.bat`,
		]);
	return candidates.find((candidate) => existsSync(candidate)) || command;
}

function buildSpawnArgs(command: string, args: string[]) {
	if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
		return {
			command: "cmd.exe",
			args: ["/d", "/s", "/c", command, ...args],
		};
	}
	return { command, args };
}

function normalizeAgentLine(line: string) {
	if (!line) return "";
	try {
		const event = JSON.parse(line);
		if (
			event?.type === "stream_event" ||
			event?.type === "system" ||
			event?.type === "user"
		)
			return "";
		const piMessage = normalizePiEvent(event);
		if (piMessage !== null) return piMessage;
		if (event?.type === "assistant" && Array.isArray(event?.message?.content)) {
			const texts = event.message.content
				.filter(
					(item: { type?: string; text?: string }) =>
						item.type === "text" && typeof item.text === "string",
				)
				.map((item: { text: string }) => item.text);
			return texts.length ? compactLine(texts.join(" ")) : "";
		}
		const text =
			event?.message?.content?.[0]?.text ||
			event?.content?.[0]?.text ||
			event?.delta?.text ||
			event?.text ||
			event?.result;
		if (typeof text === "string") return compactLine(text);
		if (event?.type === "result") return compactLine(event?.result || "");
	} catch {
		// Plain text output.
	}
	return compactLine(line);
}

function normalizePiEvent(event: unknown): string | null {
	if (!event || typeof event !== "object") return null;
	const item = event as {
		type?: string;
		id?: unknown;
		toolName?: unknown;
		name?: unknown;
		toolCallId?: unknown;
		isError?: unknown;
		error?: unknown;
		result?: unknown;
		partialResult?: unknown;
		message?: { role?: string; content?: unknown[] };
		messages?: unknown[];
		errorMessage?: unknown;
		assistantMessageEvent?: {
			type?: string;
			content?: unknown;
		};
	};

	switch (item.type) {
		case "session":
			return typeof item.id === "string" ? `pi session: ${item.id}` : "";
		case "agent_start":
		case "turn_start":
		case "turn_end":
		case "message_start":
		case "message_update":
		case "message_end":
			return normalizePiMessageEvent(item);
		case "tool_execution_start":
			return `pi tool: ${String(item.toolName || item.name || "unknown")}`;
		case "tool_execution_update":
			return "";
		case "tool_execution_end":
			if (item.isError) {
				const error =
					typeof item.error === "string"
						? item.error
						: typeof item.result === "string"
							? item.result
							: "工具执行失败";
				return `pi tool failed: ${compactLine(error)}`;
			}
			return "";
		case "agent_end":
			return "pi agent 已结束";
		default:
			return null;
	}
}

function normalizePiMessageEvent(event: {
	type?: string;
	message?: { role?: string; content?: unknown[]; errorMessage?: unknown };
	assistantMessageEvent?: { type?: string; content?: unknown };
}) {
	if (event.type !== "message_end") return "";
	if (event.message?.role !== "assistant") return "";
	if (typeof event.message.errorMessage === "string") {
		return `pi provider error: ${compactLine(event.message.errorMessage)}`;
	}
	if (!Array.isArray(event.message.content)) return "";
	const texts = event.message.content
		.filter(
			(item): item is { type?: string; text: string } =>
				typeof item === "object" &&
				item !== null &&
				(item as { type?: string }).type === "text" &&
				typeof (item as { text?: unknown }).text === "string",
		)
		.map((item) => item.text);
	return texts.length ? compactLine(texts.join(" ")) : "";
}

function extractResultMetadata(output: string): Omit<CommandResult, "output"> {
	let sessionId = "";
	let stopReason = "";
	let resultText = "";
	let errorMessage = "";
	let numTurns = 0;
	for (const line of output.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line);
			if (typeof event?.session_id === "string") sessionId = event.session_id;
			if (event?.type === "session" && typeof event.id === "string")
				sessionId = event.id;
			if (
				typeof event?.message?.errorMessage === "string" &&
				event.message.errorMessage
			) {
				errorMessage = event.message.errorMessage;
			}
			if (event?.type === "result") {
				if (typeof event.stop_reason === "string")
					stopReason = event.stop_reason;
				if (typeof event.result === "string") resultText = event.result;
				if (typeof event.num_turns === "number") numTurns = event.num_turns;
			}
			if (event?.type === "agent_end") {
				stopReason = "agent_end";
				if (Array.isArray(event.messages)) {
					const lastAssistant = [...event.messages]
						.reverse()
						.find((message) => message?.role === "assistant");
					if (
						typeof lastAssistant?.errorMessage === "string" &&
						lastAssistant.errorMessage
					) {
						errorMessage = lastAssistant.errorMessage;
					}
					const content = lastAssistant?.content;
					if (Array.isArray(content)) {
						resultText = content
							.filter(
								(item) =>
									item?.type === "text" && typeof item.text === "string",
							)
							.map((item) => item.text)
							.join("\n");
					}
				}
			}
		} catch {
			// Ignore non-JSON lines.
		}
	}
	return {
		sessionId,
		stopReason,
		numTurns,
		resultText,
		errorMessage,
	};
}

function shouldContinueAgent(
	projectDir: string,
	result: CommandResult,
	options: RunnerOptions,
) {
	if (hasPptx(projectDir)) return false;
	const text = (result.resultText || result.output).slice(-30_000);
	const svgCount = countSvgSlides(projectDir);
	const needsMoreSlides = svgCount < options.slideCount;
	return (
		result.stopReason === "tool_use" ||
		(svgCount > 0 && needsMoreSlides) ||
		(existsSync(join(projectDir, "spec_lock.md")) && needsMoreSlides) ||
		/请确认|确认后|wait for|explicit user confirmation|Eight Confirmations|继续执行|Step 7|svg_to_pptx/i.test(
			text,
		)
	);
}

function resolveMaxTurns(options: RunnerOptions) {
	const configured = Number(process.env.PPT_AGENT_MAX_TURNS);
	const recommended = Math.max(18, options.slideCount * 4 + 8);
	const minimumUseful = Math.max(12, options.slideCount + 8);
	const raw =
		Number.isFinite(configured) && configured > 0 ? configured : recommended;
	return Math.max(minimumUseful, Math.min(80, Math.round(raw)));
}

function describeContinueState(projectDir: string, options: RunnerOptions) {
	const svgCount = countSvgSlides(projectDir);
	if (svgCount >= options.slideCount)
		return "SVG 已齐，推进质量检查和 PPTX 导出";
	if (svgCount > 0)
		return `继续生成剩余 SVG（${svgCount}/${options.slideCount} 已完成）`;
	if (existsSync(join(projectDir, "spec_lock.md")))
		return "规划已完成，继续逐页写入 SVG";
	return "确认门控并推进到规划与生成";
}

function hasPptx(projectDir: string) {
	return Boolean(findLatestPptx(projectDir));
}

function canRecoverFromAgentExit(output: string, projectDir: string) {
	return (
		countSvgSlides(projectDir) > 0 &&
		/error_max_budget_usd|Reached maximum budget|"stop_reason"\s*:\s*"tool_use"/i.test(
			output,
		)
	);
}

function compactLine(line: string) {
	return line.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function updatePhaseFromLine(
	projectId: string,
	options: RunnerOptions,
	line: string,
) {
	const lower = line.toLowerCase();
	if (
		lower.includes("image") ||
		line.includes("图像") ||
		line.includes("素材")
	) {
		await updateProject(projectId, {
			status: "ACQUIRING_IMAGES",
			currentPhase: "采集或生成素材",
		});
		options.emit({
			type: "phase",
			data: { phase: "ACQUIRING_IMAGES", progress: 35 },
		});
		return;
	}
	if (
		lower.includes("svg") ||
		line.includes("executor") ||
		line.includes("生成第")
	) {
		await updateProject(projectId, {
			status: "EXECUTING",
			currentPhase: "逐页生成 SVG",
		});
		options.emit({ type: "phase", data: { phase: "EXECUTING", progress: 45 } });
		return;
	}
	if (
		lower.includes("pptx") ||
		lower.includes("export") ||
		line.includes("导出")
	) {
		await updateProject(projectId, {
			status: "EXPORTING",
			currentPhase: "导出 PPTX",
		});
		options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 88 } });
	}
}

function emitPreviews(projectId: string, options: RunnerOptions) {
	const svgDir = join(options.projectDir, "svg_output");
	if (!existsSync(svgDir)) return;
	const files = readdirSync(svgDir)
		.filter((file) => file.toLowerCase().endsWith(".svg"))
		.sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
	files.forEach((file, index) => {
		options.emit({
			type: "preview",
			data: {
				pageIndex: index,
				svgUrl: `/api/ppt/projects/${projectId}/files/svg_output/${encodeURIComponent(file)}`,
			},
		});
	});
}

async function verifyAgentOutput(
	projectId: string,
	options: RunnerOptions,
	skillDir: string,
) {
	const svgCount = countSvgSlides(options.projectDir);
	if (svgCount < 1) {
		throw new Error("PPT Master agent 没有生成任何 SVG 页面。");
	}

	await updateProject(projectId, {
		svgOutputPath: join(options.projectDir, "svg_output"),
		specPath: existsSync(join(options.projectDir, "design_spec.md"))
			? join(options.projectDir, "design_spec.md")
			: undefined,
		specLockPath: existsSync(join(options.projectDir, "spec_lock.md"))
			? join(options.projectDir, "spec_lock.md")
			: undefined,
		slideCount: svgCount,
	});

	const quality = await checkSvgQuality(options.projectDir, skillDir);
	if (quality.errors.length > 0) {
		throw new Error(`SVG 质量检查失败：${quality.errors.join("; ")}`);
	}
}

async function runServerSideExport(projectDir: string, skillDir: string) {
	await splitNotes(projectDir, skillDir).catch(() => undefined);
	await finalizeSvg(projectDir, skillDir);
	await convertSvgToPptx(projectDir, skillDir);
}

async function verifyAgentOutputWithSkill(
	projectId: string,
	options: RunnerOptions,
	skillDir: string,
) {
	await verifyAgentOutput(projectId, options, skillDir);
}

function countSvgSlides(projectDir: string) {
	const svgDir = join(projectDir, "svg_output");
	if (!existsSync(svgDir)) return 0;
	return readdirSync(svgDir).filter((file) =>
		file.toLowerCase().endsWith(".svg"),
	).length;
}

function readLivePreviewLock(projectDir: string) {
	const lockPath = join(projectDir, ".live_preview.lock");
	if (!existsSync(lockPath)) return "";
	try {
		return readFileSync(lockPath, "utf-8");
	} catch {
		return "";
	}
}

function stopProjectLivePreview(projectDir: string, previousLock: string) {
	if (process.env.PPT_AGENT_KEEP_LIVE_PREVIEW === "true") return;

	const lockPath = join(projectDir, ".live_preview.lock");
	if (!existsSync(lockPath)) return;

	try {
		const currentLock = readFileSync(lockPath, "utf-8");
		if (previousLock && currentLock === previousLock) return;

		const lock = JSON.parse(currentLock) as { pid?: unknown };
		const pid = typeof lock.pid === "number" ? lock.pid : Number(lock.pid);
		if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
			try {
				process.kill(pid);
			} catch {
				// The process may already be gone; removing a stale lock is enough.
			}
		}
		unlinkSync(lockPath);
	} catch {
		try {
			unlinkSync(lockPath);
		} catch {
			// Best-effort cleanup only.
		}
	}
}

function styleLabel(style?: string) {
	return getPptStyleLabel(style);
}
