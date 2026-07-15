import {
	spawn,
	type ChildProcessWithoutNullStreams,
	type SpawnOptionsWithoutStdio,
} from "node:child_process";
import {
	appendFileSync,
	closeSync,
	cpSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
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
	executePptPython,
	finalizeSvg,
	getPptScriptPath,
	splitNotes,
} from "./python-tools";
import {
	getPptMasterSkillDir,
	getPptMasterUpstreamVersion,
} from "./runtime-paths";
import { getPptMasterStyleContract, getPptStyleLabel } from "./styles";
import { throwIfPptCancelled } from "./cancellation";
import {
	cleanupPptPiAgentConfig,
	preparePptPiAgentConfig,
	type PreparedPiAgentConfig,
} from "./pi-agent-config";
import type { EventEmitter, GenerationParams } from "./generator";
import {
	buildPptContentInstruction,
	getPptAudienceOption,
	getPptDeliveryPurpose,
	getPptTextVolumeOption,
	getPptToneOption,
} from "./content-options";
import { buildPptDesignPreferenceInstruction } from "./design-options";
import { isThinPptSource } from "./project-utils";
import type { PptGenerationWorkflow } from "./workflow";
import { resolveImageProvider } from "@/lib/providers";
import { getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { refundPptProjectCreditsAmount } from "./refund";
import {
	ensurePptImageAnalysisCsv,
	generatePptManifestImages,
	hasPptImageManifest,
} from "./image-generation";
import { isPptImageGenerationEnabled } from "./image-options";
import {
	assertPptVisualReviewImagesRead,
	backupPptVisualReviewSlides,
	batchPptVisualReviewSlides,
	buildPptVisualReviewPrompt,
	renderPptSlidesForVisualReview,
	restorePptVisualReviewSlides,
	type PptVisualReviewSlide,
} from "./visual-review";
import { terminateProcessTree } from "./bounded-process";
import { getPptAgentTimeoutMs } from "./timings";

export interface AgentRunResult {
	pptxPath: string;
	slideCount: number;
}

interface RunnerOptions {
	projectDir: string;
	workerLease: string;
	sourceMd: string;
	slideCount: number;
	aspectRatio: "16:9" | "4:3";
	canvasFormat: "ppt169" | "ppt43";
	style: string;
	stylePrompt: string;
	styleLabel: string;
	workflow: PptGenerationWorkflow;
	nativeTemplatePath?: string;
	signal?: AbortSignal;
	visualReview: boolean;
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

const MAX_AGENT_OUTPUT_TAIL_CHARS = 500_000;
const MAX_AGENT_PENDING_LINE_CHARS = 128_000;
const MAX_AGENT_LOG_BYTES = 2 * 1024 * 1024;

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
	const upstreamVersion = getPptMasterUpstreamVersion();
	if (upstreamVersion) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			`PPT Master 上游版本：${upstreamVersion.ref} / ${upstreamVersion.commit.slice(0, 12)}`,
			options.workerLease,
		);
	}
	const skillDir = prepareProjectSkillDir(options.projectDir, sourceSkillDir);
	const piConfig = await preparePptPiAgentConfig({
		projectId: params.projectId,
		userId: params.userId,
		model: params.model,
		modelSource: params.modelSource,
	});
	await emitProjectLog(
		params.projectId,
		options.emit,
		`已准备任务专属 pi 配置：${piConfig.source === "user" ? "使用我的 API" : "平台配置"} / ${piConfig.model}`,
		options.workerLease,
	);
	try {
		return await runConfiguredPptMasterAgent(
			params,
			options,
			skillDir,
			piConfig,
		);
	} finally {
		cleanupPptPiAgentConfig(piConfig);
	}
}

async function runConfiguredPptMasterAgent(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
	piConfig: PreparedPiAgentConfig,
): Promise<AgentRunResult> {
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
		options.workerLease,
	);
	options.emit({
		type: "phase",
		data: { phase: "STRATEGIZING", progress: 12 },
	});
	await updateProject(
		params.projectId,
		{
			status: "STRATEGIZING",
			currentPhase:
				options.workflow === "template-fill"
					? "正在分析上传模板结构"
					: "正在规划内容与视觉方向",
			progress: 12,
		},
		options.workerLease,
	);

	const maxTurns = resolveMaxTurns(options);
	await emitProjectLog(
		params.projectId,
		options.emit,
		`PPT Master ${options.workflow === "template-fill" ? "模板填充" : "Executor"} 最大续跑轮次：${maxTurns}`,
		options.workerLease,
	);

	let currentTurn = 1;
	let result = await runCommand(params.projectId, command, options, currentTurn);
	if (options.workflow === "svg") {
		const requiresImageManifest = shouldGeneratePptImages(params, options);
		const requiresContentBrief = isThinPptSource(options.sourceMd);
		const maxPlanningTurns = 4;
		while (
			(!hasPptPlanningArtifacts(options.projectDir, requiresContentBrief) ||
				(requiresImageManifest && !hasPptImageManifest(options.projectDir))) &&
			currentTurn < maxPlanningTurns
		) {
			currentTurn += 1;
			const planningCommand = resolveAgentCommand(
				params.projectId,
				options.projectDir,
				skillDir,
				promptPath,
				buildPlanningContinuePrompt(
					params,
					requiresImageManifest,
					requiresContentBrief,
				),
				result.sessionId,
				piConfig,
			);
			await emitProjectLog(
				params.projectId,
				options.emit,
				`规划会话第 ${currentTurn} 轮继续完成设计契约${requiresImageManifest ? "与图片清单" : ""}`,
				options.workerLease,
			);
			result = await runCommand(
				params.projectId,
				planningCommand,
				options,
				currentTurn,
			);
		}

		if (!hasPptPlanningArtifacts(options.projectDir, requiresContentBrief)) {
			throw new Error(
				requiresContentBrief
					? "PPT Master 未在规划阶段生成 design_spec.md、spec_lock.md 和 analysis/content_brief.md。"
					: "PPT Master 未在规划阶段生成 design_spec.md 和 spec_lock.md。",
			);
		}
		if (requiresImageManifest && !hasPptImageManifest(options.projectDir)) {
			throw new Error(
				"PPT Master 未在规划阶段生成 images/image_prompts.json。",
			);
		}
		clearPrematureSlideOutputs(options.projectDir);
		if (requiresImageManifest) {
			await runSelectedImageGeneration(params, options, skillDir);
		}

		currentTurn = 1;
		await updateProject(
			params.projectId,
			{
				status: "EXECUTING",
				currentPhase: "正在用全新会话逐页生成",
				progress: 45,
			},
			options.workerLease,
		);
		const executorCommand = resolveAgentCommand(
			params.projectId,
			options.projectDir,
			skillDir,
			promptPath,
			buildFreshExecutionPrompt(params, options, requiresImageManifest),
			buildPptPhaseSessionId(params.projectId, "executor"),
			piConfig,
		);
		await emitProjectLog(
			params.projectId,
			options.emit,
			"规划阶段已完成，启动全新 Executor 会话逐页生成 PPT",
			options.workerLease,
		);
		result = await runCommand(
			params.projectId,
			executorCommand,
			options,
			currentTurn,
		);
	}

	for (
		let turn = currentTurn + 1;
		turn <= maxTurns && !hasPptx(options.projectDir);
		turn++
	) {
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
			options.workerLease,
		);
		result = await runCommand(params.projectId, continueCommand, options, turn);
	}

	if (
		!hasPptx(options.projectDir) &&
		shouldContinueAgent(options.projectDir, result, options)
	) {
		if (options.workflow === "template-fill") {
			throw new Error(
				`PPT Master 原生模板填充达到最大续跑轮次 ${maxTurns} 后仍未导出 PPTX。最后一轮 stop_reason=${result.stopReason || "unknown"}。`,
			);
		}
		const svgCount = countSvgSlides(options.projectDir);
		await emitProjectLog(
			params.projectId,
			options.emit,
			`agent 达到最大续跑轮次 ${maxTurns} 后仍未完成，当前 SVG ${svgCount}/${options.slideCount}。`,
			options.workerLease,
		);
		if (svgCount < options.slideCount) {
			throw new Error(
				`PPT Master agent 未完成全部页面：已生成 ${svgCount}/${options.slideCount} 个 SVG。最后一轮 stop_reason=${
					result.stopReason || "unknown"
				}。请提高 PPT_AGENT_MAX_TURNS 或减少页数后重试。`,
			);
		}
	}

	await verifyAgentOutputWithSkill(params.projectId, options, skillDir);
	if (options.workflow === "svg" && options.visualReview) {
		if (!piConfig.supportsVision) {
			throw new Error("所选 PPT 模型不支持图片输入，无法执行视觉复核。");
		}
		await runHostedVisualReview({
			params,
			options,
			skillDir,
			promptPath,
			piConfig,
			previous: result,
			firstReviewTurn: maxTurns + 1,
		});
		await verifyAgentOutputWithSkill(params.projectId, options, skillDir);
	}

	options.emit({ type: "phase", data: { phase: "EXPORTING", progress: 90 } });
	throwIfPptCancelled(options.signal);
	await updateProject(
		params.projectId,
		{
			status: "EXPORTING",
			currentPhase: "校验并收集 PPTX 输出",
			progress: 90,
		},
		options.workerLease,
	);

	let pptxPath = findLatestPptx(options.projectDir);
	if (options.workflow === "svg" && options.visualReview) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			"视觉复核已结束，服务器重新执行 Step 7 导出 PPTX",
			options.workerLease,
		);
		await runServerSideExport(options.projectDir, skillDir);
		pptxPath = findLatestPptx(options.projectDir);
	}
	if (
		options.workflow === "svg" &&
		!pptxPath &&
		countSvgSlides(options.projectDir) > 0
	) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			"agent 已生成 SVG，服务器接管 Step 7 导出 PPTX",
			options.workerLease,
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
		slideCount:
			options.workflow === "template-fill"
				? readTemplateFillSlideCount(options.projectDir) || options.slideCount
				: countSvgSlides(options.projectDir) || options.slideCount,
	};
}

function writeAgentPrompt(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
) {
	const promptPath = join(options.projectDir, "agent-task.md");
	const sourcePath = join(options.projectDir, "sources", "source.md");
	const output =
		options.workflow === "template-fill"
			? buildNativeTemplateFillPrompt(params, options, skillDir, sourcePath)
			: buildSvgGenerationPrompt(params, options, skillDir, sourcePath);

	writeFileSync(promptPath, output, "utf-8");
	return promptPath;
}

function buildSvgGenerationPrompt(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
	sourcePath: string,
) {
	const textVolume = getPptTextVolumeOption(params.textVolume);
	const audience = getPptAudienceOption(params.audience);
	const tone = getPptToneOption(params.tone);
	const deliveryPurpose = getPptDeliveryPurpose(params.textVolume);
	const styleContract = getPptMasterStyleContract(
		params.style,
		params.stylePrompt,
	);
	const thinSource = isThinPptSource(options.sourceMd);
	const imageInstructions = params.imageModel
		? [
					`- 本任务已选择图片生成模型。规划阶段必须在 images/image_prompts.json 中安排 1-${params.imageCountLimit || 1} 张真正有助于叙事的 AI 图片。`,
					"- 图片清单必须使用 PPT Master manifest schema；每项 status 写 Pending，文件名只使用安全的英文、数字、下划线或短横线，并以 .png 结尾。",
					"- 第一阶段只完成 design_spec.md、spec_lock.md 和 images/image_prompts.json。不要调用 image_gen.py，不要调用网页搜图，不要生成 SVG，不要导出 PPTX；写完清单后立即结束本轮。",
					"- 官方图片路径锁定为 host-native；服务器会负责实际生成，并补齐 image_prompts.md 与 image_analysis.csv。",
					"- 图片 API 由服务器在两阶段之间调用。不要查找、读取、请求或记录任何图片 API Key。",
				]
			: [
					"- 本任务未启用 AI 图片。不得创建 ai 或 web 类型图片任务，不得调用 image_gen.py 或 image_search.py；项目内已有用户图片可标记为 provided/user，否则 image_usage 锁定为 none。",
					"- 第一阶段只完成 design_spec.md 和 spec_lock.md。不要生成 SVG，不要导出 PPTX；完成规划文件后立即结束本轮。",
				];
	return [
		"# PPT Master Server Task",
		"",
		"你是服务器内置的 PPT Master Strategist。当前只执行规划阶段，后续 Executor 将在全新会话中继续。",
		"",
		"## Hard Requirements",
		"",
		"- 先完整阅读 PPT Master skill 文件，再执行工作流。",
		"- 本任务的用户输入已经在站内表单确认过。下面的 `USER CONFIRMS` 行就是 Step 4 Strategist confirmation stage 的显式用户确认；不要再向用户请求确认。",
		"- Hosted confirmation override: 用户明确选择站内表单作为确认界面，不要启动 `confirm_ui/server.py`，不要等待本地网页。按 SKILL 的 chat-fallback/opt-out 路径处理，并把下方参数视为三阶段最终确认值。",
		"- 如果 workflow 文档要求输出 Strategist confirmation recommendations，请把最终值及选择理由写入 `design_spec.md` 的 planning context 或日志，然后继续执行。不要把“请确认”作为最终回答。",
		"- `mode` 与 `visual_style` 必须使用官方目录 id。参数为 auto 时，先读对应 `_index.md` 后选择并锁定一个 id；参数非 auto 时直接锁定，不得改写为站内中文风格名。",
		"- 所有可见幻灯片文字必须使用简体中文。只有 AI、API、LLM、SaaS、PPTX 等无法自然翻译的产品名或技术缩写可以保留英文。",
		"- 本会话不得生成任何 SVG、notes 或 PPTX；只允许完成内容简报、design_spec.md、spec_lock.md 和所需图片清单。",
		"- 在 design_spec.md 的逐页大纲中为每页指定明确的叙事职责、page_rhythm 和主构图家族，避免把所有页面规划成卡片阵列。",
		"- 不要修改项目目录以外的任何文件。只允许写入当前 PPT 项目目录。",
		"- `.ppt-master-skill/` 是服务器提供的只读工具副本；不得修改其中任何文件。如果工具脚本失败，记录原因并终止，不要尝试绕过。",
		"- Hosted-mode override: 本站前端会直接预览 `svg_output/`，不要启动长期运行的 `svg_editor/server.py` live preview 服务；这一步视为由站内 SSE 预览替代。",
		"- 如果缺少 API key、依赖或 agent 权限，明确写入失败原因，不要生成假文件。",
		...imageInstructions,
		"",
		"## Paths",
		"",
		`- PPT Master skill private copy: ${skillDir}`,
		`- Project path: ${options.projectDir}`,
		`- Source markdown: ${sourcePath}`,
		"",
		"## Confirmed Parameters",
		"",
		"USER CONFIRMS: I approve the hosted Strategist confirmation values, split generation mode, and refine_spec=false. Continue without opening the Confirm UI or asking another question.",
		`- Canvas: ${options.aspectRatio} (${options.canvasFormat})`,
		`- Target slide count: ${options.slideCount}`,
		`- Style: ${options.styleLabel || styleLabel(options.style)}`,
		`- Official communication mode: ${styleContract.mode}`,
		`- Official visual style: ${styleContract.visualStyle}`,
		styleContract.visualStyleBehavior
			? `- Official visual_style_behavior: ${styleContract.visualStyleBehavior}`
			: "",
		`- Official delivery_purpose: ${deliveryPurpose}`,
		`- Template hint/path: ${params.template || "(none, free design)"}`,
		`- Text volume: ${textVolume.label}`,
		`- Target audience: ${audience.label}`,
		`- Tone: ${tone.label}`,
		"- Output language: Simplified Chinese for all visible slide text",
		params.imageModel
			? `- Image usage: ai via host-native server adapter, selected model ${params.imageModel}, maximum ${params.imageCountLimit || 1} images`
			: "- Image usage: provided project images only when present; otherwise none",
		"",
		"## Style Requirements",
		"",
		options.stylePrompt,
		buildPptDesignPreferenceInstruction({
			colorPreference: params.colorPreference,
			typographyPreference: params.typographyPreference,
		}),
		"",
		buildHostedCompositionQualityContract(options.slideCount),
		"",
		"## Content Requirements",
		"",
		buildPptContentInstruction({
			textVolume: params.textVolume,
			audience: params.audience,
			tone: params.tone,
		}),
		thinSource
			? [
					"",
					"## Thin Source Preparation",
					"",
					"用户提供的资料较少。在写 design_spec.md 前，先把受众目标、核心观点、可验证的通用知识、具体示例、逐页叙事职责和事实边界写入 analysis/content_brief.md。",
					"不得杜撰统计数字、研究结论、机构、客户案例或引用；没有来源支持的具体数据不要写入幻灯片。",
					"内容简报必须让各页承担不同职责，例如开场、问题、关键洞察、示例、方法、应用与行动，而不是围绕主题重复改写。",
				].join("\n")
			: "",
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
		"When design_spec.md, spec_lock.md, analysis/content_brief.md when required, and the optional image manifest are complete, print a concise planning-complete line and stop.",
		"",
	].join("\n");
}

function buildPlanningContinuePrompt(
	params: GenerationParams,
	requiresImageManifest: boolean,
	requiresContentBrief: boolean,
) {
	return [
		"继续完成 PPT Master 规划阶段，不要进入 SVG、notes 或 PPTX 生成。",
		"站内确认仍然有效；不要启动 confirm_ui/server.py，不要再次请求确认。",
		"保留已有 design_spec.md 和 spec_lock.md；如果缺少则补齐。",
		requiresContentBrief
			? "本任务资料较少，必须补齐 analysis/content_brief.md，明确事实边界、具体示例和逐页叙事职责。"
			: "本任务不要求额外生成 analysis/content_brief.md。",
		requiresImageManifest
			? `必须写入 images/image_prompts.json，按 PPT Master manifest schema 规划 1-${params.imageCountLimit || 1} 张图片，所有 status 为 Pending。`
			: "本任务未启用 AI 图片，不要创建图片生成清单。",
		"不要调用 image_gen.py、网页搜图或任何图片 API。规划文件齐全后立即结束本轮。",
	].join("\n");
}

function buildFreshExecutionPrompt(
	params: GenerationParams,
	options: RunnerOptions,
	hasGeneratedImages: boolean,
) {
	return [
		"# PPT Master Fresh Executor Session",
		"",
		"这是与 Strategist 完全隔离的全新执行会话。先阅读 `.ppt-master-skill/SKILL.md` 和 `.ppt-master-skill/workflows/resume-execute.md`，从官方 Step 6 开始，不要重新规划。",
		"确认 design_spec.md 和 spec_lock.md 存在，然后读取它们；如果 analysis/content_brief.md 存在也必须读取。生成具体页面内容时重新读取 sources/source.md，不能只依赖大纲摘要。",
		hasGeneratedImages
			? "服务器已完成图片生成。读取 images/image_prompts.json、images/image_prompts.md 和 analysis/image_analysis.csv；只使用 status=Generated 且文件实际存在的图片，不得重新生成、搜索或替换图片。"
			: "本任务未启用 AI 图片。只可使用项目内已有用户图片；没有可用图片时使用文字、原生图形、图表和留白完成叙事。",
		hasGeneratedImages
			? "status=Needs-Manual 的图片视为不可用：移除页面对它们的依赖，不得保留缺图占位框。"
			: "不要创建图片生成任务，不要调用 image_gen.py 或 image_search.py。",
		"不要读取或请求任何 API Key。除移除不可用图片依赖外，不要改写 design_spec.md、spec_lock.md 或图片清单。",
		"进入 Executor 前读取 .ppt-master-skill/references/executor-base.md、.ppt-master-skill/references/shared-standards.md、spec_lock.md 锁定的 .ppt-master-skill/references/modes/ 与 .ppt-master-skill/references/visual-styles/ 文件、.ppt-master-skill/references/image-layout-spec.md 和 .ppt-master-skill/references/svg-image-embedding.md。",
		`从第 1 页开始逐页生成 svg_output/*.svg，目标 ${options.slideCount} 页；每页前重新读取 spec_lock.md。`,
		"不得写脚本批量生成 SVG，不得生成占位页，不得跳过页面。",
		buildHostedCompositionQualityContract(options.slideCount),
		options.visualReview
			? "完成全部页面和 notes 后运行质量检查并修复，然后立即停止本轮，等待服务器托管视觉复核；不要执行 Step 7 导出。"
			: "完成全部页面和 notes 后运行质量检查并修复，再执行 total_md_split.py、finalize_svg.py、svg_to_pptx.py，在 exports/ 下生成可编辑 PPTX。",
		"所有可见文字使用简体中文。不要启动 confirm_ui/server.py、visual_review.py 或长期运行的 live-preview server。",
		`图片模型仅用于已落盘素材：${params.imageModel || "未选择"}。完成前不要停止或请求确认。`,
	].join("\n");
}

function buildHostedCompositionQualityContract(slideCount: number) {
	const minimumFamilies = Math.min(5, Math.max(3, Math.ceil(slideCount / 3)));
	return [
		"托管成品质量契约：",
		`- 全套至少使用 ${minimumFamilies} 种有实质差异的主构图家族，例如全幅图像、强标题留白、流程、对比、数据图表、时间轴或单一焦点；换颜色不算新构图。`,
		"- 不得连续两页使用相同主构图；规则卡片阵列只在内容确实需要分类对比时使用，默认整套不超过两页。",
		"- 每页必须有一个第一视觉焦点；正文保持演示距离可读，不能通过缩小字号塞入内容。",
		"- 图片必须承担主题、场景、证据或叙事作用，不能只作为与内容无关的背景装饰。",
		"- 在 design_spec.md 和 spec_lock.md 中锁定 page_rhythm 与逐页构图职责，Executor 按锁定职责执行。",
	].join("\n");
}

async function runHostedVisualReview(input: {
	params: GenerationParams;
	options: RunnerOptions;
	skillDir: string;
	promptPath: string;
	piConfig: PreparedPiAgentConfig;
	previous: CommandResult;
	firstReviewTurn: number;
}) {
	const { params, options } = input;
	throwIfPptCancelled(options.signal);
	resetOutputDirectory(join(options.projectDir, "exports"));
	const slides = await renderPptSlidesForVisualReview({
		projectDir: options.projectDir,
		aspectRatio: options.aspectRatio,
	});
	const batches = batchPptVisualReviewSlides(slides);
	const allBackups = backupPptVisualReviewSlides(options.projectDir, slides);
	const backupBySvg = new Map(
		allBackups.map((backup) => [backup.svgPath, backup]),
	);
	const protectedPaths = ["design_spec.md", "spec_lock.md"]
		.map((file) => join(options.projectDir, file))
		.filter(existsSync);
	let previous = input.previous;
	const reviewSessionId = buildPptPhaseSessionId(params.projectId, "review");

	await emitProjectLog(
		params.projectId,
		options.emit,
		`开始服务器托管视觉复核：${slides.length} 页，共 ${batches.length} 批`,
		options.workerLease,
	);

	for (const [batchIndex, batch] of batches.entries()) {
		throwIfPptCancelled(options.signal);
		const untouchedSnapshots = snapshotUnassignedReviewFiles(
			slides,
			batch,
			protectedPaths,
		);
		const progress = Math.min(
			88,
			82 + Math.floor(((batchIndex + 1) / batches.length) * 6),
		);
		await updateProject(
			params.projectId,
			{
				status: "EXECUTING",
				currentPhase: `AI 视觉复核（${batchIndex + 1}/${batches.length}）`,
				progress,
			},
			options.workerLease,
		);
		options.emit({ type: "progress", data: { progress } });

		const command = resolveAgentCommand(
			params.projectId,
			options.projectDir,
			input.skillDir,
			input.promptPath,
			buildPptVisualReviewPrompt(batch, batchIndex, batches.length),
			batchIndex === 0 ? reviewSessionId : previous.sessionId,
			input.piConfig,
		);
		try {
			const reviewed = await runCommand(
				params.projectId,
				command,
				options,
				input.firstReviewTurn + batchIndex,
			);
			assertPptVisualReviewImagesRead(reviewed.output, batch);
			restoreReviewSnapshots(untouchedSnapshots);
			const quality = await checkSvgQuality(options.projectDir, input.skillDir);
			if (quality.errors.length > 0) {
				throw new Error("视觉复核修改未通过 SVG 静态质量检查");
			}
			await renderPptSlidesForVisualReview({
				projectDir: options.projectDir,
				aspectRatio: options.aspectRatio,
				svgFiles: batch.map((slide) => slide.svgFile),
			});
			previous = reviewed;
			await emitProjectLog(
				params.projectId,
				options.emit,
				`视觉复核第 ${batchIndex + 1}/${batches.length} 批完成`,
				options.workerLease,
			);
		} catch (error) {
			throwIfPptCancelled(options.signal);
			const failureReason = getVisualReviewFailureReason(error);
			restoreReviewSnapshots(untouchedSnapshots);
			restorePptVisualReviewSlides(
				batch
					.map((slide) => backupBySvg.get(slide.svgPath))
					.filter((backup): backup is NonNullable<typeof backup> => Boolean(backup)),
			);
			await renderPptSlidesForVisualReview({
				projectDir: options.projectDir,
				aspectRatio: options.aspectRatio,
				svgFiles: batch.map((slide) => slide.svgFile),
			});
			writeFileSync(
				join(
					options.projectDir,
					".review",
					`batch-${String(batchIndex + 1).padStart(2, "0")}.md`,
				),
				`# Visual Review Batch ${batchIndex + 1}\n\n- status: rolled_back\n- reason: ${failureReason}\n`,
				"utf-8",
			);
			await emitProjectLog(
				params.projectId,
				options.emit,
				`视觉复核第 ${batchIndex + 1}/${batches.length} 批未通过，已恢复原稿：${failureReason}`,
				options.workerLease,
			);
		}
	}
}

function getVisualReviewFailureReason(error: unknown) {
	const message = error instanceof Error ? error.message : "";
	if (message.startsWith("模型未实际读取")) return "模型未完整读取本批截图";
	if (message.includes("SVG 静态质量检查")) {
		return "修改未通过 SVG 静态质量检查";
	}
	if (message.includes("空白页")) return "修改后的页面渲染为空白";
	return "模型调用或页面复核未完成";
}

function snapshotUnassignedReviewFiles(
	allSlides: PptVisualReviewSlide[],
	batch: PptVisualReviewSlide[],
	protectedPaths: string[],
) {
	const assigned = new Set(batch.map((slide) => slide.svgPath));
	return [...allSlides.map((slide) => slide.svgPath), ...protectedPaths]
		.filter((path) => !assigned.has(path) && existsSync(path))
		.map((path) => ({ path, content: readFileSync(path) }));
}

function restoreReviewSnapshots(
	snapshots: Array<{ path: string; content: Buffer }>,
) {
	for (const snapshot of snapshots) {
		if (
			!existsSync(snapshot.path) ||
			!readFileSync(snapshot.path).equals(snapshot.content)
		) {
			writeFileSync(snapshot.path, snapshot.content);
		}
	}
}

function shouldGeneratePptImages(
	params: GenerationParams,
	options: RunnerOptions,
) {
	return isPptImageGenerationEnabled({
		workflow: options.workflow,
		imageModel: params.imageModel,
		imageModelSource: params.imageModelSource,
		imageCountLimit: params.imageCountLimit,
	});
}

function hasPptPlanningArtifacts(
	projectDir: string,
	requiresContentBrief: boolean,
) {
	return (
		existsSync(join(projectDir, "design_spec.md")) &&
		existsSync(join(projectDir, "spec_lock.md")) &&
		(!requiresContentBrief ||
			existsSync(join(projectDir, "analysis", "content_brief.md")))
	);
}

function clearPrematureSlideOutputs(projectDir: string) {
	resetOutputDirectory(join(projectDir, "svg_output"));
	resetOutputDirectory(join(projectDir, "exports"));
}

function resetOutputDirectory(path: string) {
	if (existsSync(path)) rmSync(path, { recursive: true, force: true });
	mkdirSync(path, { recursive: true });
}

async function runSelectedImageGeneration(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
) {
	if (!params.imageModel || !params.imageModelSource) {
		throw new Error("PPT 图片模型参数不完整。");
	}
	const maxImages = Math.max(1, Math.min(8, params.imageCountLimit || 1));
	throwIfPptCancelled(options.signal);
	await updateProject(
		params.projectId,
		{
			status: "ACQUIRING_IMAGES",
			currentPhase: "正在生成 PPT 配图",
			progress: 35,
		},
		options.workerLease,
	);
	options.emit({
		type: "phase",
		data: { phase: "ACQUIRING_IMAGES", progress: 35 },
	});

	const resolved = await resolveImageProvider(
		params.userId,
		"IMAGE",
		params.imageModel,
		params.imageModelSource,
	);
	await emitProjectLog(
		params.projectId,
		options.emit,
		`服务器开始生成 PPT 配图：${resolved.source === "user" ? "我的 API" : "平台"} / ${resolved.model}`,
		options.workerLease,
	);
	const timeoutSeconds = await getSettingNumber(
		SETTING_KEYS.IMAGE_REQUEST_TIMEOUT_SECONDS,
	);
	const requestTimeoutMs =
		timeoutSeconds === 0
			? 0
			: Math.max(1, Math.floor(timeoutSeconds || 180)) * 1000;
	const generated = await generatePptManifestImages({
		projectDir: options.projectDir,
		provider: resolved.provider,
		model: resolved.model,
		maxImages,
		signal: options.signal,
		requestTimeoutMs,
	});
	await executePptPython(
		getPptScriptPath("image_gen.py", skillDir),
		["--render-md", generated.manifestPath],
		60_000,
		skillDir,
	);
	await executePptPython(
		getPptScriptPath("analyze_images.py", skillDir),
		[join(options.projectDir, "images")],
		180_000,
		skillDir,
	);
	ensurePptImageAnalysisCsv(options.projectDir, generated.generatedCount === 0);

	const unusedReservation =
		(maxImages - generated.generatedCount) *
		Math.max(0, Math.floor(params.imageUnitCreditCost || 0));
	if (unusedReservation > 0) {
		await refundPptProjectCreditsAmount(
			params.projectId,
			unusedReservation,
			`PPT 配图未生成额度退款（${maxImages - generated.generatedCount} 张）`,
			options.workerLease,
		);
	}
	await emitProjectLog(
		params.projectId,
		options.emit,
		generated.failedCount > 0
			? `PPT 配图生成完成：成功 ${generated.generatedCount} 张，重试后仍失败 ${generated.failedCount} 张；已自动降级继续`
			: `PPT 配图生成完成：${generated.generatedCount} 张`,
		options.workerLease,
	);
}

function buildNativeTemplateFillPrompt(
	params: GenerationParams,
	options: RunnerOptions,
	skillDir: string,
	sourcePath: string,
) {
	if (!options.nativeTemplatePath) {
		throw new Error("原生模板填充缺少项目内模板路径。");
	}

	const textVolume = getPptTextVolumeOption(params.textVolume);
	const audience = getPptAudienceOption(params.audience);
	const tone = getPptToneOption(params.tone);
	return [
		"# PPT Master Native Template Fill Task",
		"",
		"你是服务器内置的 PPT Master 执行 agent。本任务必须执行 `workflows/template-fill-pptx.md` 原生模板填充工作流，不得进入主 SVG 生成流程。",
		"",
		"## Hard Requirements",
		"",
		"- 先阅读 PPT Master SKILL.md 和 `workflows/template-fill-pptx.md`，再执行命令。",
		"- 用户已经在站内明确上传模板并点击生成，这等价于批准页面选择、复用和填充方案。生成 `fill_plan.json` 后直接检查并应用，不要停下来请求第二次确认。",
		"- 禁止运行 `pptx_to_svg.py`、`pptx_template_import.py`、`finalize_svg.py` 或 `svg_to_pptx.py`。",
		"- 必须直接克隆原生幻灯片并修改 OOXML，保留模板母版、布局、图片、形状、图表、表格、字体、动画和空间关系。",
		"- 模板视觉是唯一视觉依据，不得用站内风格预设覆盖或重新设计模板。",
		`- 最终输出严格为 ${options.slideCount} 页；模板页面不足时选择合适的内容页重复使用，但每次填入不同内容。`,
		"- 所有需要替换的模板示例文案必须替换完整，不得残留无关标题、正文、年份、广告、下载站署名或英文口号。",
		"- 所有可见幻灯片文字使用简体中文，必要的产品名和技术缩写除外。",
		"- 文案必须适配原占位区域容量。标题过长先改写，正文过长先压缩或拆到其他模板页，不得通过极小字号硬塞。",
		"- 每个事实只能来自 `sources/source.md`；资料不足时保持概括，不得编造数据、机构、案例或来源。",
		"- 只允许写入当前项目目录。缺少依赖或模板不可解析时明确失败，不得生成假文件。",
		"",
		"## Required Execution",
		"",
		`1. 使用 ${skillDir}/scripts/template_fill_pptx.py analyze 分析 ${options.nativeTemplatePath}，输出 analysis/slide_library.json。`,
		"2. 阅读完整 slide library 和 `sources/source.md`，按目标叙事与版式容量手工编写 `analysis/fill_plan.json`。",
		"3. 运行 `check-plan` 并把报告写到 `analysis/check_report.json`；修复全部 error，并尽量消除容量 warning。",
		"4. 运行 `apply`，输出到 `exports/generated.pptx`，使用 `--transition keep` 保留模板原有转场。",
		"5. 使用 `source_to_md/ppt_to_md.py` 回读最终 PPTX，输出 `validation/readback.md`，核对页数、标题、正文、表格和备注。",
		"6. 确认 `exports/` 中存在最终可编辑 PPTX 后再结束。",
		"",
		"## Paths",
		"",
		`- PPT Master skill private copy: ${skillDir}`,
		`- Project path: ${options.projectDir}`,
		`- Native template: ${options.nativeTemplatePath}`,
		`- Source markdown: ${sourcePath}`,
		"",
		"## Confirmed Parameters",
		"",
		`- Target slide count: ${options.slideCount}`,
		`- Text volume: ${textVolume.label}`,
		`- Target audience: ${audience.label}`,
		`- Tone: ${tone.label}`,
		"- Visual style: inherit the uploaded native PPTX exactly",
		"- Output language: Simplified Chinese",
		"",
		"## Content Requirements",
		"",
		buildPptContentInstruction({
			textVolume: params.textVolume,
			audience: params.audience,
			tone: params.tone,
		}),
		"",
		"## Source Content",
		"",
		"```markdown",
		options.sourceMd,
		"```",
		"",
		"完成后只需简要报告最终 PPTX 路径和实际页数。",
		"",
	].join("\n");
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
	const extensionPath = join(process.cwd(), "scripts", "ppt-agent-extension.mjs");
	if (!existsSync(extensionPath)) {
		throw new Error(`PPT agent 安全工具扩展不存在：${extensionPath}`);
	}
	const args = [
		"-p",
		"--mode",
		"json",
		"--approve",
		"--no-builtin-tools",
		"--no-extensions",
		"--no-context-files",
		"--extension",
		extensionPath,
		"--provider",
		piConfig.provider,
		"--model",
		piConfig.model,
		"--thinking",
		piConfig.thinkingLevel,
		"--skill",
		skillDir,
		"--tools",
		"read,write,edit,bash,grep,find,ls",
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
	if (options.workflow === "template-fill") {
		return buildTemplateFillContinuePrompt(projectDir, turn, previous);
	}

	const svgCount = countSvgSlides(projectDir);
	const nextSlide = Math.min(svgCount + 1, options.slideCount);
	const interruptedByToolUse = previous.stopReason === "tool_use";

	if (svgCount >= options.slideCount) {
		return [
			"确认继续。当前目标页数的 SVG 页面已经生成，请不要重新开始，也不要重写已有 SVG。",
			options.visualReview
				? "完成 notes/total.md 并运行 svg_quality_checker.py；修复全部 error 后立即停止，等待服务器托管视觉复核，不要执行 Step 7 导出。"
				: "继续执行 PPT Master Step 7：质量检查、notes/total.md、total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
			options.visualReview
				? "不要请求确认，也不要自行启动 visual_review.py 或 live-preview server。"
				: "必须在 exports/ 下生成可编辑 PPTX。完成前不要停止或请求确认。",
		].join("\n");
	}

	if (svgCount > 0) {
		return [
			"确认继续。不要重新开始，不要重写已有 SVG。",
			`当前 svg_output/ 已有 ${svgCount}/${options.slideCount} 页。请从第 ${nextSlide} 页继续逐页生成，直到第 ${options.slideCount} 页全部完成。`,
			options.visualReview
				? "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，然后停止等待服务器托管视觉复核；不要执行 Step 7。"
				: "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
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
			options.visualReview
				? "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，然后停止等待服务器托管视觉复核；不要执行 Step 7。"
				: "每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，再执行 Step 7 导出 PPTX。",
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
		`这是服务器自动续跑第 ${turn} 轮，等价于用户明确回复“确认，继续”。`,
		options.visualReview
			? "请立刻继续执行 PPT Master 规划与 Executor 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md，运行质量检查并修复，然后停止等待服务器托管视觉复核；不要执行 Step 7。"
			: "请立刻继续执行完整 PPT Master 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md，运行质量检查并修复，然后执行 total_md_split.py、finalize_svg.py、svg_to_pptx.py。",
		"不要再输出确认问题。不要只输出计划。完成前不要停止。",
	].join("\n");
}

function buildTemplateFillContinuePrompt(
	projectDir: string,
	turn: number,
	previous: CommandResult,
) {
	const hasLibrary = existsSync(
		join(projectDir, "analysis", "slide_library.json"),
	);
	const hasPlan = existsSync(join(projectDir, "analysis", "fill_plan.json"));
	const hasReport = existsSync(
		join(projectDir, "analysis", "check_report.json"),
	);
	return [
		`这是原生模板填充的服务器自动续跑第 ${turn} 轮。不要重新开始，也不要切换到 SVG 流程。`,
		`当前状态：slide_library=${hasLibrary ? "已有" : "缺少"}，fill_plan=${hasPlan ? "已有" : "缺少"}，check_report=${hasReport ? "已有" : "缺少"}。`,
		"继续执行 `workflows/template-fill-pptx.md`：完成 analyze、fill_plan、check-plan、apply 和最终 PPTX 回读验证。",
		"用户已批准站内生成流程，不要请求第二次确认。必须在 exports/ 下生成原生可编辑 PPTX 后才能结束。",
		previous.stopReason === "tool_use"
			? "上一轮停在工具调用边界；检查文件是否落盘，必要时重新执行未完成的命令。"
			: "",
	]
		.filter(Boolean)
		.join("\n");
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

function buildPptPhaseSessionId(projectId: string, phase: string) {
	return sanitizeAgentSessionId(`${projectId}-${phase}`);
}

function buildAgentPathEnv() {
	const pythonCmd = process.env.PPT_PYTHON_CMD?.trim();
	if (!pythonCmd || process.platform === "win32") return process.env.PATH;
	const pythonDir = dirname(pythonCmd);
	if (!pythonDir || pythonDir === ".") return process.env.PATH;
	return [pythonDir, process.env.PATH].filter(Boolean).join(":");
}

function buildAgentProcessEnv(command: AgentCommand): NodeJS.ProcessEnv {
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !isSensitiveAgentEnv(name)),
	);
	return {
		...environment,
		NODE_ENV: process.env.NODE_ENV,
		PATH: buildAgentPathEnv(),
		PI_CODING_AGENT_DIR: command.piConfig.configDir,
		PPT_PI_API_KEY: command.piConfig.apiKey,
		PPT_PI_PROVIDER: command.piConfig.provider,
		PPT_PI_MODEL: command.piConfig.model,
		PPT_MASTER_SKILL_DIR: command.skillDir,
		PPT_AGENT_PROJECT_DIR: command.cwd,
		PPT_PYTHON_CMD: process.env.PPT_PYTHON_CMD,
		PYTHONIOENCODING: "utf-8",
	};
}

function isSensitiveAgentEnv(name: string) {
	return (
		name === "DATABASE_URL" ||
		name === "FAL_KEY" ||
		/(?:^|_)(?:API_KEY|API_TOKEN|SECRET|PASSWORD)$/.test(name)
	);
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
		const timeoutMs = getPptAgentTimeoutMs();

	return new Promise<CommandResult>((resolvePromise, reject) => {
		const spawnTarget = resolveExecutable(command.command);
		const spawnArgs = buildSpawnArgs(spawnTarget, command.args);
		const proc: ChildProcessWithoutNullStreams = spawn(
			spawnArgs.command,
			spawnArgs.args,
			{
				cwd: command.cwd,
				windowsHide: true,
				env: buildAgentProcessEnv(command),
				detached: process.platform !== "win32",
			} satisfies SpawnOptionsWithoutStdio,
		);

		let output = "";
		let settled = false;
		const startedAt = Date.now();
		let logBytes = existsSync(logPath) ? statSync(logPath).size : 0;
		let logLimitReached = logBytes >= MAX_AGENT_LOG_BYTES;
		const appendAgentLog = (text: string) => {
			if (logLimitReached) return;
			const bytes = Buffer.byteLength(text);
			if (logBytes + bytes <= MAX_AGENT_LOG_BYTES) {
				appendFileSync(logPath, text, "utf-8");
				logBytes += bytes;
				return;
			}
			const marker =
				"\n[server] agent-output.log 已达到 2 MiB 上限，后续原始日志不再写入。\n";
			const markerBytes = Buffer.byteLength(marker);
			if (logBytes + markerBytes <= MAX_AGENT_LOG_BYTES) {
				appendFileSync(logPath, marker, "utf-8");
				logBytes += markerBytes;
			}
			logLimitReached = true;
		};
		appendAgentLog(
			[
				"",
				`\n===== PPT Master agent turn ${turn} started ${new Date().toISOString()} =====`,
				`cwd: ${command.cwd}`,
				`command: ${command.display}`,
				"",
			].join("\n"),
		);

		const timer = setInterval(() => {
			const elapsed = Date.now() - startedAt;
			const progress = Math.min(
				88,
				12 + Math.floor((elapsed / timeoutMs) * 72),
			);
			options.emit({ type: "progress", data: { progress } });
			updateProject(projectId, { progress }, options.workerLease).catch(
				onError("agent-runner", "更新进度失败"),
			);
			emitPreviews(projectId, options);
		}, 15_000);

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			clearInterval(timer);
			options.signal?.removeEventListener("abort", abort);
			terminateProcessTree(proc);
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
			terminateProcessTree(proc);
			reject(
				options.signal?.reason instanceof Error
					? options.signal.reason
					: new Error("用户已停止生成"),
			);
		};
		if (options.signal?.aborted) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });

		const processLine = (line: string) => {
			const message = normalizeAgentLine(line.trim());
			if (message) {
				appendAgentLog(`${message}\n`);
				emitProjectLog(
					projectId,
					options.emit,
					message,
					options.workerLease,
				).catch(
					onError("agent-runner", "写入项目日志失败"),
				);
				updatePhaseFromLine(projectId, options, message).catch(
					onError("agent-runner", "更新阶段失败"),
				);
			}
		};
		let stdoutPending = "";
		let stderrPending = "";
		const longLineReported = { stdout: false, stderr: false };
		const boundLine = (stream: "stdout" | "stderr", line: string) => {
			if (line.length <= MAX_AGENT_PENDING_LINE_CHARS) return line;
			if (!longLineReported[stream]) {
				longLineReported[stream] = true;
				appendAgentLog(
					`[server] ${stream} 单行超过 ${MAX_AGENT_PENDING_LINE_CHARS} 字符，日志解析仅保留尾部。\n`,
				);
			}
			return line.slice(-MAX_AGENT_PENDING_LINE_CHARS);
		};
		const onChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			output = (output + text).slice(-MAX_AGENT_OUTPUT_TAIL_CHARS);
			const pending = stream === "stdout" ? stdoutPending : stderrPending;
			const lines = (pending + text).split(/\r?\n/);
			const nextPending = boundLine(stream, lines.pop() || "");
			if (stream === "stdout") {
				stdoutPending = nextPending;
			} else {
				stderrPending = nextPending;
			}
			for (const line of lines) {
				const boundedLine = boundLine(stream, line);
				if (boundedLine.trim()) processLine(boundedLine);
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
							options.workerLease,
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
						options.workerLease,
					).catch(onError("agent-runner", "发出项目日志失败"));
				resolvePromise({ output, ...metadata });
				return;
			}
			if (canRecoverFromAgentExit(output, options.projectDir, options.workflow)) {
				await emitProjectLog(
					projectId,
					options.emit,
					"agent 在最后阶段退出，检测到可恢复输出，继续由服务器完成导出。",
					options.workerLease,
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
	if (options.workflow === "template-fill") {
		const hasProgress = [
			join(projectDir, "analysis", "slide_library.json"),
			join(projectDir, "analysis", "fill_plan.json"),
			join(projectDir, "analysis", "check_report.json"),
		].some(existsSync);
		return (
			result.stopReason === "tool_use" ||
			hasProgress ||
			/请确认|确认后|continue|继续|template.fill|fill_plan|check-plan|apply/i.test(
				text,
			)
		);
	}
	const svgCount = countSvgSlides(projectDir);
	if (options.visualReview && svgCount >= options.slideCount) return false;
	const needsMoreSlides = svgCount < options.slideCount;
	return (
		result.stopReason === "tool_use" ||
		(svgCount > 0 && needsMoreSlides) ||
		(existsSync(join(projectDir, "spec_lock.md")) && needsMoreSlides) ||
		/请确认|确认后|wait for|explicit user confirmation|Eight Confirmations|Strategist confirmation|继续执行|Step 7|svg_to_pptx/i.test(
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
	if (options.workflow === "template-fill") {
		if (existsSync(join(projectDir, "analysis", "check_report.json")))
			return "模板填充方案已检查，继续应用并回读 PPTX";
		if (existsSync(join(projectDir, "analysis", "fill_plan.json")))
			return "模板填充方案已生成，继续容量检查和应用";
		if (existsSync(join(projectDir, "analysis", "slide_library.json")))
			return "模板结构已分析，继续编写原生填充方案";
		return "开始分析原生 PPTX 模板";
	}
	const svgCount = countSvgSlides(projectDir);
	if (svgCount >= options.slideCount)
		return options.visualReview
			? "SVG 已齐，推进静态质量检查并等待视觉复核"
			: "SVG 已齐，推进质量检查和 PPTX 导出";
	if (svgCount > 0)
		return `继续生成剩余 SVG（${svgCount}/${options.slideCount} 已完成）`;
	if (existsSync(join(projectDir, "spec_lock.md")))
		return "规划已完成，继续逐页写入 SVG";
	return "确认门控并推进到规划与生成";
}

function hasPptx(projectDir: string) {
	return Boolean(findLatestPptx(projectDir));
}

function canRecoverFromAgentExit(
	output: string,
	projectDir: string,
	workflow: PptGenerationWorkflow,
) {
	const hasRecoverableArtifacts =
		workflow === "template-fill"
			? existsSync(join(projectDir, "analysis", "slide_library.json"))
			: countSvgSlides(projectDir) > 0;
	return (
		hasRecoverableArtifacts &&
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
		await updateProject(
			projectId,
			{
				status: "ACQUIRING_IMAGES",
				currentPhase: "采集或生成素材",
			},
			options.workerLease,
		);
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
		await updateProject(
			projectId,
			{
				status: "EXECUTING",
				currentPhase: "逐页生成 SVG",
			},
			options.workerLease,
		);
		options.emit({ type: "phase", data: { phase: "EXECUTING", progress: 45 } });
		return;
	}
	if (
		lower.includes("pptx") ||
		lower.includes("export") ||
		line.includes("导出")
	) {
		await updateProject(
			projectId,
			{
				status: "EXPORTING",
				currentPhase: "导出 PPTX",
			},
			options.workerLease,
		);
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

	await updateProject(
		projectId,
		{
			svgOutputPath: join(options.projectDir, "svg_output"),
			specPath: existsSync(join(options.projectDir, "design_spec.md"))
				? join(options.projectDir, "design_spec.md")
				: undefined,
			specLockPath: existsSync(join(options.projectDir, "spec_lock.md"))
				? join(options.projectDir, "spec_lock.md")
				: undefined,
			slideCount: svgCount,
		},
		options.workerLease,
	);

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
	if (options.workflow === "template-fill") {
		await verifyNativeTemplateFillOutput(projectId, options, skillDir);
		return;
	}
	await verifyAgentOutput(projectId, options, skillDir);
}

async function verifyNativeTemplateFillOutput(
	projectId: string,
	options: RunnerOptions,
	skillDir: string,
) {
	const analysisDir = join(options.projectDir, "analysis");
	const requiredArtifacts = [
		join(analysisDir, "slide_library.json"),
		join(analysisDir, "fill_plan.json"),
		join(analysisDir, "check_report.json"),
	];
	const missing = requiredArtifacts.filter((path) => !existsSync(path));
	if (missing.length > 0) {
		throw new Error(
			`原生模板填充缺少验收文件：${missing.map((path) => path.slice(options.projectDir.length + 1)).join("、")}`,
		);
	}

	const slideCount = readTemplateFillSlideCount(options.projectDir);
	if (slideCount !== options.slideCount) {
		throw new Error(
			`原生模板填充页数不正确：方案为 ${slideCount} 页，目标为 ${options.slideCount} 页。`,
		);
	}

	const checkReport = readJsonFile(join(analysisDir, "check_report.json"));
	const errorCount = Number(
		(checkReport.summary as Record<string, unknown> | undefined)?.error || 0,
	);
	if (errorCount > 0) {
		throw new Error(`原生模板填充容量检查仍有 ${errorCount} 个错误。`);
	}

	const pptxPath = findLatestPptx(options.projectDir);
	if (!pptxPath || statSync(pptxPath).size < 4 || !hasZipSignature(pptxPath)) {
		throw new Error("原生模板填充没有生成有效 PPTX 文件。");
	}

	const validationDir = join(options.projectDir, "validation");
	mkdirSync(validationDir, { recursive: true });
	const readbackPath = join(validationDir, "readback.md");
	await executePptPython(
		getPptScriptPath(join("source_to_md", "ppt_to_md.py"), skillDir),
		[pptxPath, "-o", readbackPath],
		300_000,
		skillDir,
	);
	if (!existsSync(readbackPath) || statSync(readbackPath).size === 0) {
		throw new Error("原生模板填充 PPTX 回读验证没有产生有效内容。");
	}

	await updateProject(
		projectId,
		{ slideCount, pptxPath },
		options.workerLease,
	);
}

function readTemplateFillSlideCount(projectDir: string) {
	const planPath = join(projectDir, "analysis", "fill_plan.json");
	if (!existsSync(planPath)) return 0;
	const plan = readJsonFile(planPath);
	return Array.isArray(plan.slides) ? plan.slides.length : 0;
}

function readJsonFile(path: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Report a stable validation error below.
	}
	throw new Error(`无法读取 PPT 验收文件：${path}`);
}

function hasZipSignature(path: string) {
	const descriptor = openSync(path, "r");
	try {
		const signature = Buffer.alloc(2);
		return readSync(descriptor, signature, 0, 2, 0) === 2 && signature.toString() === "PK";
	} finally {
		closeSync(descriptor);
	}
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
