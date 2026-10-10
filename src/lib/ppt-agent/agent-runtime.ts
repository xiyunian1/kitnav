export interface AgentResultMetadata {
	sessionId: string;
	stopReason: string;
	numTurns: number;
	resultText: string;
	errorMessage: string;
	usage: AgentUsage;
}

/** 一次 agent 会话内所有模型回复的用量合计。cost 单位与 models.json 中配置的单价一致（元/百万 token）。 */
export interface AgentUsage {
	llmCalls: number;
	/** 至少一条回复带有 token 用量；为 false 时说明服务商没有在流式响应中返回用量。 */
	reported: boolean;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
}

interface PiUsage {
	input?: unknown;
	output?: unknown;
	cacheRead?: unknown;
	cacheWrite?: unknown;
	totalTokens?: unknown;
	cost?: { total?: unknown };
}

interface PiAssistantMessage {
	role?: unknown;
	stopReason?: unknown;
	stop_reason?: unknown;
	errorMessage?: unknown;
	content?: unknown;
	usage?: PiUsage;
	timestamp?: unknown;
	responseId?: unknown;
}

export function emptyAgentUsage(): AgentUsage {
	return {
		llmCalls: 0,
		reported: false,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0,
	};
}

function finiteNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export interface PptArtifactWatchdogState {
	lastSignature: string;
	lastProgressAt: number;
}

export interface PptStageProgressState {
	stage: number;
	consecutiveNoProgressTurns: number;
}

export interface PptExecutorProgressState {
	svgCount: number;
	speakerNotesComplete: boolean;
	qualityValid: boolean;
	artifactSignature: string;
	qualityErrorCount: number | null;
	consecutiveNoProgressTurns: number;
}

export interface PptExecutorContinuePromptInput {
	turn: number;
	slideCount: number;
	svgCount: number;
	hasSpecLock: boolean;
	stopReason: string;
	qualityErrors?: string[];
}

export interface PptAttemptSessionInput {
	projectId: string;
	phase: string;
	retryAttempt?: number;
	workerLease: string;
}

const DEFAULT_MAX_NO_PROGRESS_TURNS = 2;
const MAX_CONFIGURED_NO_PROGRESS_TURNS = 10;
const DEFAULT_NO_ARTIFACT_TIMEOUT_MS = 15 * 60_000;
const MIN_NO_ARTIFACT_TIMEOUT_MS = 60_000;
const MAX_NO_ARTIFACT_TIMEOUT_MS = 2 * 60 * 60_000;

export class AgentResultMetadataCollector {
	private readonly metadata: AgentResultMetadata;
	private sawAgentEnd = false;
	/** 同一条回复会出现在 message_end、turn_end 和 agent_end 中，按时间戳和响应 ID 去重后再累计用量。 */
	private readonly countedMessages = new Set<string>();

	constructor(requestedSessionId: string) {
		this.metadata = {
			sessionId: requestedSessionId,
			stopReason: "",
			numTurns: 0,
			resultText: "",
			errorMessage: "",
			usage: emptyAgentUsage(),
		};
	}

	consumeJsonLine(line: string) {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (!event || typeof event !== "object") return;
		const item = event as {
			type?: unknown;
			message?: PiAssistantMessage;
			messages?: unknown;
			stop_reason?: unknown;
			result?: unknown;
			num_turns?: unknown;
		};

		if (item.type === "turn_end") {
			this.metadata.numTurns += 1;
		}
		if (item.message) this.consumeAssistantMessage(item.message);
		// 流式过程中的 message_start / message_update 只有部分用量，只在消息完成的事件里累计
		if (item.message && (item.type === "message_end" || item.type === "turn_end")) {
			this.consumeUsage(item.message);
		}
		if (item.type === "result") {
			if (typeof item.stop_reason === "string") {
				this.metadata.stopReason = item.stop_reason;
			}
			if (typeof item.result === "string") {
				this.metadata.resultText = item.result;
			}
			if (typeof item.num_turns === "number" && Number.isFinite(item.num_turns)) {
				this.metadata.numTurns = item.num_turns;
			}
		}
		if (item.type === "agent_end") {
			this.sawAgentEnd = true;
			// agent_end 在续跑同一会话时可能包含之前轮次的消息，不从这里累计用量，避免重复计算
			if (Array.isArray(item.messages)) {
				const lastAssistant = [...item.messages]
					.reverse()
					.find(
						(message): message is PiAssistantMessage =>
							Boolean(
								message &&
									typeof message === "object" &&
									(message as PiAssistantMessage).role === "assistant",
							),
					);
				if (lastAssistant) this.consumeAssistantMessage(lastAssistant);
			}
		}
	}

	getMetadata(): AgentResultMetadata {
		return {
			...this.metadata,
			usage: { ...this.metadata.usage },
			stopReason:
				this.metadata.stopReason || (this.sawAgentEnd ? "agent_end" : ""),
		};
	}

	private consumeUsage(message: PiAssistantMessage) {
		if (message.role !== "assistant") return;
		const usage = message.usage;
		if (!usage || typeof usage !== "object") return;
		const key = `${String(message.timestamp ?? "")}:${String(message.responseId ?? "")}`;
		if (key === ":" || this.countedMessages.has(key)) return;
		this.countedMessages.add(key);
		const total = this.metadata.usage;
		total.llmCalls += 1;
		const input = finiteNumber(usage.input);
		const output = finiteNumber(usage.output);
		const cacheRead = finiteNumber(usage.cacheRead);
		const cacheWrite = finiteNumber(usage.cacheWrite);
		total.inputTokens += input;
		total.outputTokens += output;
		total.cacheReadTokens += cacheRead;
		total.cacheWriteTokens += cacheWrite;
		total.cost += finiteNumber(usage.cost?.total);
		if (input + output + cacheRead + cacheWrite + finiteNumber(usage.totalTokens) > 0) {
			total.reported = true;
		}
	}

	private consumeAssistantMessage(message: PiAssistantMessage) {
		if (message.role !== "assistant") return;
		const stopReason =
			typeof message.stopReason === "string"
				? message.stopReason
				: typeof message.stop_reason === "string"
					? message.stop_reason
					: "";
		if (stopReason) this.metadata.stopReason = stopReason;
		if (typeof message.errorMessage === "string" && message.errorMessage) {
			this.metadata.errorMessage = message.errorMessage;
		}
		if (!Array.isArray(message.content)) return;
		const text = message.content
			.filter(
				(item): item is { type: "text"; text: string } =>
					Boolean(
						item &&
							typeof item === "object" &&
							(item as { type?: unknown }).type === "text" &&
							typeof (item as { text?: unknown }).text === "string",
					),
			)
			.map((item) => item.text)
			.join("\n");
		if (text) this.metadata.resultText = text;
	}
}

export function extractAgentResultMetadata(
	output: string,
	requestedSessionId: string,
): AgentResultMetadata {
	const collector = new AgentResultMetadataCollector(requestedSessionId);
	for (const line of output.split(/\r?\n/)) {
		collector.consumeJsonLine(line);
	}
	return collector.getMetadata();
}

/**
 * 从会话 ID 中取出阶段名。会话 ID 由 buildPptAttemptSessionId 生成，格式为
 * `<projectId>-<phase>-a<retryAttempt>-<workerLease 前 12 位>`；不符合该格式时返回 "agent"。
 */
export function parsePptSessionPhase(projectId: string, sessionId: string) {
	const prefix = `${sanitizePptAgentSessionId(projectId)}-`;
	if (!sessionId.startsWith(prefix)) return "agent";
	const match = sessionId.slice(prefix.length).match(/^(.+?)-a\d+-/);
	return match ? match[1] : "agent";
}

export function sanitizePptAgentSessionId(value: string) {
	const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
	return sanitized || `ppt-${Date.now()}`;
}

export function buildPptAttemptSessionId(input: PptAttemptSessionInput) {
	const retryAttempt = Math.max(0, Math.floor(input.retryAttempt || 0));
	const leaseSuffix = input.workerLease.slice(0, 12);
	return sanitizePptAgentSessionId(
		`${input.projectId}-${input.phase}-a${retryAttempt}-${leaseSuffix}`,
	);
}

export function createPptArtifactWatchdogState(
	signature: string,
	now = Date.now(),
): PptArtifactWatchdogState {
	return { lastSignature: signature, lastProgressAt: now };
}

export function recordPptArtifactWatchdogProgress(
	previous: PptArtifactWatchdogState,
	signature: string,
	now = Date.now(),
): PptArtifactWatchdogState {
	return signature === previous.lastSignature
		? previous
		: { lastSignature: signature, lastProgressAt: now };
}

export function isPptArtifactWatchdogExpired(
	state: PptArtifactWatchdogState,
	now: number,
	timeoutMs: number,
) {
	return now - state.lastProgressAt >= timeoutMs;
}

export function resolvePptNoArtifactTimeoutMs(
	configured = process.env.PPT_AGENT_NO_ARTIFACT_TIMEOUT_MS,
) {
	const parsed = Number(configured);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_NO_ARTIFACT_TIMEOUT_MS;
	}
	return Math.max(
		MIN_NO_ARTIFACT_TIMEOUT_MS,
		Math.min(MAX_NO_ARTIFACT_TIMEOUT_MS, Math.round(parsed)),
	);
}

export function createPptExecutorProgressState(
	svgCount = 0,
	speakerNotesComplete = false,
	qualityValid = false,
	artifactSignature = "",
	qualityErrorCount: number | null = qualityValid ? 0 : null,
): PptExecutorProgressState {
	return {
		svgCount,
		speakerNotesComplete,
		qualityValid,
		artifactSignature,
		qualityErrorCount,
		consecutiveNoProgressTurns: 0,
	};
}

export function recordPptExecutorProgress(
	previous: PptExecutorProgressState,
	svgCount: number,
	speakerNotesComplete = false,
	qualityValid = false,
	artifactSignature = "",
	qualityErrorCount: number | null = qualityValid ? 0 : null,
): PptExecutorProgressState {
	const artifactChanged = artifactSignature !== previous.artifactSignature;
	const qualityErrorsReduced =
		qualityErrorCount !== null &&
		previous.qualityErrorCount !== null &&
		qualityErrorCount < previous.qualityErrorCount;
	return {
		svgCount,
		speakerNotesComplete,
		qualityValid,
		artifactSignature,
		qualityErrorCount,
		consecutiveNoProgressTurns:
			svgCount > previous.svgCount ||
			(speakerNotesComplete && !previous.speakerNotesComplete) ||
			(qualityValid && !previous.qualityValid) ||
			artifactChanged ||
			qualityErrorsReduced
				? 0
				: previous.consecutiveNoProgressTurns + 1,
	};
}

export function isPptExecutorStalled(
	progress: PptExecutorProgressState,
	slideCount: number,
	maxNoProgressTurns: number,
) {
	return (
		(progress.svgCount < slideCount ||
			!progress.speakerNotesComplete ||
			!progress.qualityValid) &&
		progress.consecutiveNoProgressTurns >= maxNoProgressTurns
	);
}

export function resolvePptExecutorMaxNoProgressTurns(
	configured = process.env.PPT_EXECUTOR_MAX_NO_PROGRESS_TURNS,
) {
	const parsed = Number(configured);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_MAX_NO_PROGRESS_TURNS;
	}
	return Math.max(
		1,
		Math.min(MAX_CONFIGURED_NO_PROGRESS_TURNS, Math.round(parsed)),
	);
}

export function createPptStageProgressState(
	stage: number,
): PptStageProgressState {
	return { stage, consecutiveNoProgressTurns: 0 };
}

export function recordPptStageProgress(
	previous: PptStageProgressState,
	stage: number,
): PptStageProgressState {
	return {
		stage,
		consecutiveNoProgressTurns:
			stage > previous.stage ? 0 : previous.consecutiveNoProgressTurns + 1,
	};
}

export function isPptStageProgressStalled(
	progress: PptStageProgressState,
	maxNoProgressTurns: number,
) {
	return progress.consecutiveNoProgressTurns >= maxNoProgressTurns;
}

export function resolvePptTemplateMaxNoProgressTurns(
	configured = process.env.PPT_TEMPLATE_MAX_NO_PROGRESS_TURNS,
) {
	return resolvePptExecutorMaxNoProgressTurns(configured);
}

export function buildPptExecutorContinuePrompt(
	input: PptExecutorContinuePromptInput,
) {
	const nextSlide = Math.min(input.svgCount + 1, input.slideCount);
	const interruptedByToolUse = input.stopReason === "tool_use";
	const interruptedByLength = input.stopReason === "length";
	const lengthInstruction = interruptedByLength
		? "上一轮因模型输出长度上限结束。当前 Executor 会话已保留完成的资料与官方参考读取；禁止重新读取 SKILL.md、重新扫描参考/模板/图标目录或重复准备。仅补读明确缺少的锁定模板，然后直接继续页面写入。"
		: "";
	const qualityInstruction =
		input.qualityErrors && input.qualityErrors.length > 0
			? [
					`宿主质量检查发现 ${input.qualityErrors.length} 项必须修复的问题。只修改涉及的 SVG，不要重写无关页面：`,
					...input.qualityErrors
						.slice(0, 10)
						.map((error) => `- ${error.slice(0, 500)}`),
				].join("\n")
			: "";

	if (input.svgCount >= input.slideCount) {
		return [
			"确认继续。当前目标页数的 SVG 页面已经生成，请不要重新开始，也不要重写已有 SVG。",
			lengthInstruction,
			qualityInstruction,
			"完成 notes/total.md，并按宿主列出的错误修复相关 SVG 后立即停止。不要运行 svg_quality_checker.py；服务器会重新执行质量门并在仍有错误时继续发送精确结果。不要执行 Step 7，不要运行 total_md_split.py、finalize_svg.py 或 svg_to_pptx.py。",
			"不要请求确认，也不要自行启动 visual_review.py 或 live-preview server；图表校准、可选视觉复核和最终导出由服务器接管。",
		]
			.filter(Boolean)
			.join("\n");
	}

	if (input.svgCount > 0) {
		return [
			"确认继续。不要重新开始，不要重写已有 SVG。",
			lengthInstruction,
			qualityInstruction,
			`当前 svg_output/ 已有 ${input.svgCount}/${input.slideCount} 页。请重新读取 spec_lock.md，然后从第 ${nextSlide} 页继续逐页生成，直到第 ${input.slideCount} 页全部完成。`,
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md 并立即停止；不要运行 svg_quality_checker.py，服务器会统一检查并把具体错误发回当前会话。不要执行 Step 7。",
			interruptedByToolUse
				? "上一轮停在工具调用边界；如果上一条工具写入没有落盘，请重新发起对应写入或 Bash 工具调用。"
				: "",
			"完成前不要停止，不要请求确认。",
		]
			.filter(Boolean)
			.join("\n");
	}

	if (input.hasSpecLock) {
		return [
			"确认继续。design_spec.md 和 spec_lock.md 已经存在，请不要重新规划，不要重写这两个文件。",
			lengthInstruction,
			`当前还没有 SVG 落盘。现在重新读取 spec_lock.md，然后直接写入第 1 页 SVG，并继续逐页生成 svg_output/*.svg，目标页数 ${input.slideCount}。`,
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md 并立即停止；不要运行 svg_quality_checker.py，服务器会统一检查并把具体错误发回当前会话。不要执行 Step 7。",
			interruptedByToolUse
				? "上一轮停在未完成的工具调用边界；请先完成或重做上一条 SVG Write 工具调用。"
				: "",
			"完成前不要停止，不要请求确认。",
		]
			.filter(Boolean)
			.join("\n");
	}

	return [
		"我确认并批准上一轮 Strategist confirmation stage 的全部站内参数。",
		`这是服务器自动续跑第 ${input.turn} 轮，等价于用户明确回复“确认，继续”。`,
		lengthInstruction,
		"请立刻继续执行 PPT Master 规划与 Executor 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md 后立即停止；不要运行 svg_quality_checker.py，服务器会统一检查并发送精确错误。不要执行 Step 7。",
		"不要再输出确认问题。不要只输出计划。完成前不要停止。",
	]
		.filter(Boolean)
		.join("\n");
}
