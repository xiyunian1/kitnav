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
import { dirname, join, resolve } from "path";
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
import { reconcilePptProjectCredits } from "./refund";
import { getPptCreditsPerSlide } from "./billing";
import {
	ensurePptImageAnalysisCsv,
	generatePptManifestImages,
} from "./image-generation";
import { isPptImageGenerationEnabled } from "./image-options";
import {
	assertPptVisualReviewImagesRead,
	backupPptVisualReviewSlides,
	batchPptVisualReviewSlides,
	buildPptVisualReviewPrompt,
	renderPptSlidesForVisualReview,
	restorePptVisualReviewSlides,
} from "./visual-review";
import { terminateProcessTree } from "./bounded-process";
import { getPptAgentTimeoutMs } from "./timings";
import { normalizePptSpecLock } from "./artifacts";
import { getPptInternalErrorMessage } from "./status";
import {
	assertExactPptSvgCount,
	assertPptChartVerification,
	assertPptSpeakerNotesSource,
	assertPptSplitSpeakerNotes,
	assertPptxReadback,
	findPptSvgFileByPage,
	listPptDataChartReferences,
	listPptVisualizationReferences,
	writePptChartVerificationEvidence,
} from "./output-validation";
import {
	assertPptPlanningDecisionApplied,
	assertPptPlanningRecommendations,
	assertPptPlanningStageDerived,
	getPptPlanningDecisionPath,
	getPptPlanningDraftPath,
	getPptPlanningRecommendationsPath,
	hasPptPlanningDecision,
	hasPptPlanningRecommendations,
	PptPlanningConfirmationRequiredError,
	readPptPlanningDraft,
	readPptPlanningRecommendations,
	readPptPlanningResult,
	resolvePptPlanningSelection,
	writeAutomaticPptPlanningDecision,
} from "./planning-confirmation";
import {
	PptAgentToolCallCollector,
	type PptAgentToolCall,
	writePptExecutionEvidence,
} from "./execution-evidence";
import {
	assertNativeTemplateFillArtifacts,
	assertNativeTemplatePptxPackage,
} from "./template-fill-validation";
import {
	assertPptTemplateFillDecisionApplied,
	getPptTemplateFillDecisionPath,
	hasPptTemplateFillDecision,
} from "./template-fill-confirmation";
import {
	assertPptChartCalculatorResults,
	executePptChartCalculatorRequests,
	getPptChartCalculatorRequestsPath,
	getPptChartCalculatorResultsPath,
} from "./chart-calculator";
import {
	runWithProtectedFileGuard,
	snapshotDirectoryFiles,
	snapshotDirectoryTreeFiles,
	snapshotFileStates,
	type ProtectedDirectorySnapshot,
	type ProtectedFileSnapshot,
} from "./protected-files";
import {
	assertPptStrategistEvidence,
	getPptStrategistEvidencePath,
	writePptStrategistEvidence,
} from "./planning-evidence";
import {
	assertPptImagePromptEvidence,
	getPptImagePromptEvidencePath,
	writePptImagePromptEvidence,
} from "./image-prompt-planning";
import { runPptPostExecutionGates } from "./post-execution";

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
	toolCalls: PptAgentToolCall[];
	toolCaptureComplete: boolean;
}

interface PptAgentPhaseProtection {
	files: ProtectedFileSnapshot[];
	directories: ProtectedDirectorySnapshot[];
	rollbackFiles?: ProtectedFileSnapshot[];
}

function emptyCommandResult(): CommandResult {
	return {
		output: "",
		sessionId: "",
		stopReason: "",
		numTurns: 0,
		resultText: "",
		errorMessage: "",
		toolCalls: [],
		toolCaptureComplete: true,
	};
}

const MAX_AGENT_OUTPUT_TAIL_CHARS = 500_000;
const MAX_AGENT_PENDING_LINE_CHARS = 128_000;
const MAX_AGENT_LOG_BYTES = 2 * 1024 * 1024;
const MAX_AGENT_EVIDENCE_LINE_CHARS = 32 * 1024 * 1024;

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

	const maxTurns = resolveMaxTurns(options);
	await emitProjectLog(
		params.projectId,
		options.emit,
		`PPT Master ${options.workflow === "template-fill" ? "模板填充" : "Executor"} 最大续跑轮次：${maxTurns}`,
		options.workerLease,
	);

	let currentTurn = 1;
	let result = emptyCommandResult();
	const executorToolCalls: PptAgentToolCall[] = [];
	let executorToolCaptureComplete = true;
	const strategistToolCalls: PptAgentToolCall[] = [];
	let strategistToolCaptureComplete = true;
	let initialPhaseProtection: PptAgentPhaseProtection | null = null;
	let executorPhaseProtection: PptAgentPhaseProtection | null = null;
	const resumeExistingPlanning =
		options.workflow === "svg" &&
		Boolean(params.planningConfirmed || params.planningConfirmationStage);
	if (resumeExistingPlanning) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			params.planningConfirmed
				? "恢复已确认的规划任务，跳过资料转换和初始 Strategist 会话"
				: "恢复分阶段确认任务，跳过资料转换和初始 Strategist 会话",
			options.workerLease,
		);
	} else {
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
			initialPhaseProtection = createInitialAgentPhaseProtection(params, options);
			result = await runProtectedAgentCommand(
				params.projectId,
				command,
				options,
				currentTurn,
				initialPhaseProtection,
				options.workflow === "template-fill"
					? "PPT 原生模板流程"
					: "PPT 初始 Strategist",
			);
			if (options.workflow === "svg") {
				appendPptToolCalls(strategistToolCalls, result.toolCalls);
				strategistToolCaptureComplete &&= result.toolCaptureComplete;
			}
	}
	if (options.workflow === "svg") {
		const requiresAiImages = shouldGeneratePptImages(params, options);
		const requiresContentBrief = isThinPptSource(options.sourceMd);
		const maxPlanningTurns = 4;
		while (
			!resumeExistingPlanning &&
			(!hasPptPlanningArtifacts(options.projectDir, requiresContentBrief) ||
				!hasPptPlanningRecommendations(options.projectDir)) &&
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
						requiresAiImages,
						requiresContentBrief,
				),
				result.sessionId,
				piConfig,
			);
			await emitProjectLog(
				params.projectId,
				options.emit,
				`规划会话第 ${currentTurn} 轮继续完成设计契约与资源意图`,
				options.workerLease,
			);
				result = await runProtectedAgentCommand(
					params.projectId,
					planningCommand,
					options,
					currentTurn,
					initialPhaseProtection,
					"PPT Strategist 续跑",
				);
				appendPptToolCalls(strategistToolCalls, result.toolCalls);
				strategistToolCaptureComplete &&= result.toolCaptureComplete;
			}

			if (!hasPptPlanningArtifacts(options.projectDir, requiresContentBrief)) {
			throw new Error(
				requiresContentBrief
					? "PPT Master 未在规划阶段生成 design_spec.md、spec_lock.md 和 analysis/content_brief.md。"
					: "PPT Master 未在规划阶段生成 design_spec.md 和 spec_lock.md。",
				);
			}
			if (resumeExistingPlanning) {
				assertPptStrategistEvidence(options.projectDir);
			} else {
				writePptStrategistEvidence(
					options.projectDir,
					strategistToolCalls,
					strategistToolCaptureComplete,
				);
			}
			let recommendations = assertPptPlanningRecommendations(
			options.projectDir,
				{
					expectedSlideCount: options.slideCount,
					allowAiImages: requiresAiImages,
					skillDir,
				},
		);
		if (
			params.confirmDesign &&
			!params.planningConfirmed &&
			(params.planningConfirmationStage === "design-system" ||
				params.planningConfirmationStage === "execution")
		) {
			recommendations = await runHostedPlanningStageDerivation({
				params,
				options,
				skillDir,
				promptPath,
				piConfig,
				stage: params.planningConfirmationStage,
				turn: currentTurn + 1,
				requiresImageManifest: requiresAiImages,
			});
			throw new PptPlanningConfirmationRequiredError(
				"design",
				params.planningConfirmationStage,
			);
		}
		if (!hasPptPlanningDecision(options.projectDir)) {
			if (params.confirmDesign && !params.planningConfirmed) {
				throw new PptPlanningConfirmationRequiredError("design", "direction");
			}
			writeAutomaticPptPlanningDecision(options.projectDir);
			await emitProjectLog(
				params.projectId,
				options.emit,
				"设计确认未启用，已自动采用 Strategist 推荐方案",
				options.workerLease,
			);
		}
		const decision = readPptPlanningResult(options.projectDir);
		resolvePptPlanningSelection(recommendations, decision);
		let planningDecisionAlreadyApplied = false;
		try {
			assertPptPlanningDecisionApplied(options.projectDir);
			planningDecisionAlreadyApplied = true;
		} catch {
			// The independent refinement session applies any newly confirmed choices.
		}
		if (planningDecisionAlreadyApplied) {
			await emitProjectLog(
				params.projectId,
				options.emit,
				"已复用应用完成的设计契约，跳过重复规划修订",
				options.workerLease,
			);
		} else {
			await updateProject(
				params.projectId,
				{
					status: "STRATEGIZING",
					currentPhase: "正在应用已确认的设计方案",
					progress: 32,
				},
				options.workerLease,
			);
			const refinementCommand = resolveAgentCommand(
				params.projectId,
				options.projectDir,
				skillDir,
				promptPath,
				buildPlanningRefinementPrompt(params, options),
				buildPptPhaseSessionId(params.projectId, "planning-refinement"),
				piConfig,
			);
			await emitProjectLog(
				params.projectId,
				options.emit,
				"启动独立规划修订会话，将确认结果写入执行契约",
				options.workerLease,
			);
			const refinementProtection = createPlanningRefinementProtection(options);
			result = await runProtectedAgentCommand(
				params.projectId,
				refinementCommand,
				options,
				currentTurn + 1,
				refinementProtection,
				"PPT 规划修订",
			);
		}
		if (!hasPptPlanningArtifacts(options.projectDir, requiresContentBrief)) {
			throw new Error("应用设计确认结果后规划文件不完整。");
		}
		assertPptPlanningDecisionApplied(options.projectDir);
		const removedSpecLockMetadata = normalizePptSpecLock(options.projectDir);
		if (removedSpecLockMetadata > 0) {
			await emitProjectLog(
				params.projectId,
				options.emit,
				"已规范化 spec_lock.md 字体段，移除仅属于规划阶段的元数据",
				options.workerLease,
			);
		}
		clearPrematureSlideOutputs(options.projectDir);
		if (requiresAiImages) {
			await runHostedImagePromptPlanning({
				params,
				options,
				skillDir,
				promptPath,
				piConfig,
				firstTurn: currentTurn + 2,
			});
			await runSelectedImageGeneration(params, options, skillDir);
		}
			executorPhaseProtection = createExecutorPhaseProtection(options);

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
			buildFreshExecutionPrompt(params, options, requiresAiImages),
			buildPptPhaseSessionId(params.projectId, "executor"),
			piConfig,
		);
		await emitProjectLog(
			params.projectId,
			options.emit,
			"规划阶段已完成，启动全新 Executor 会话逐页生成 PPT",
			options.workerLease,
		);
			result = await runProtectedAgentCommand(
				params.projectId,
				executorCommand,
				options,
				currentTurn,
				executorPhaseProtection,
				"PPT Executor",
			);
			assertPptPlanningDecisionApplied(options.projectDir);
		appendPptToolCalls(executorToolCalls, result.toolCalls);
		executorToolCaptureComplete &&= result.toolCaptureComplete;
	}

	for (
		let turn = currentTurn + 1;
		turn <= maxTurns && !hasPptx(options.projectDir);
		turn++
	) {
		throwIfPptCancelled(options.signal);
		if (isTemplateFillConfirmationReady(params, options)) break;
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
			params,
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
		const phaseProtection =
			options.workflow === "svg"
				? executorPhaseProtection
				: initialPhaseProtection;
		result = await runProtectedAgentCommand(
			params.projectId,
			continueCommand,
			options,
			turn,
			phaseProtection,
			options.workflow === "svg"
				? "PPT Executor 续跑"
				: "PPT 原生模板流程续跑",
		);
		if (options.workflow === "svg") {
			appendPptToolCalls(executorToolCalls, result.toolCalls);
			executorToolCaptureComplete &&= result.toolCaptureComplete;
		}
	}

	if (isTemplateFillConfirmationReady(params, options)) {
		if (hasPptx(options.projectDir)) {
			throw new Error("模板填充方案确认前不允许生成 PPTX。");
		}
		assertNativeTemplateFillArtifacts(options.projectDir, options.slideCount, {
			requiredStatus: "draft",
		});
		throw new PptPlanningConfirmationRequiredError(
			"template-fill",
			"template-fill",
		);
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

	if (options.workflow === "svg") {
		assertPptPlanningDecisionApplied(options.projectDir);
		writePptExecutionEvidence(
			options.projectDir,
			executorToolCalls,
			options.slideCount,
			executorToolCaptureComplete,
		);
		await emitProjectLog(
			params.projectId,
			options.emit,
			"Executor 官方读取与逐页写入顺序已通过宿主证据校验",
			options.workerLease,
		);
	}
	await verifyAgentOutputWithSkill(params.projectId, options, skillDir);
	if (options.workflow === "svg") {
		if (options.visualReview && !piConfig.supportsVision) {
			throw new Error("所选 PPT 模型不支持图片输入，无法执行视觉复核。");
		}
		await runPptPostExecutionGates({
			visualReview: options.visualReview,
			verifyCharts: async (reason) =>
				runHostedChartVerification({
					params,
					options,
					skillDir,
					promptPath,
					piConfig,
					firstVerificationTurn:
						reason === "initial" ? maxTurns + 1 : maxTurns + 30,
					sessionPhase:
						reason === "initial"
							? "chart-verification"
							: "chart-reverification",
				}),
			verifyOutput: () =>
				verifyAgentOutput(params.projectId, options, skillDir),
			assertChartEvidence: () =>
				assertPptChartVerification(options.projectDir),
			runVisualReview: options.visualReview
				? () =>
						runHostedVisualReview({
							params,
							options,
							skillDir,
							promptPath,
							piConfig,
							previous: result,
							firstReviewTurn: maxTurns + 10,
						})
				: undefined,
			onChartEvidenceInvalid: () =>
				emitProjectLog(
					params.projectId,
					options.emit,
					"视觉复核修改了图表页，正在依据最终 SVG 重新校准坐标",
					options.workerLease,
				),
		});
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
	if (options.workflow === "svg") {
		await emitProjectLog(
			params.projectId,
			options.emit,
			"服务器正在根据已校验的 SVG 与讲稿重新执行官方 Step 7 导出",
			options.workerLease,
		);
		resetOutputDirectory(join(options.projectDir, "exports"));
		await runServerSideExport(
			options.projectDir,
			skillDir,
			options.slideCount,
		);
		pptxPath = findLatestPptx(options.projectDir);
	}
	if (!pptxPath) {
		throw new Error(
			"PPT Master agent 已结束，但没有在 exports/ 下生成 PPTX。请查看项目日志和 agent-output.log。",
		);
	}
	await validateExportedPptx(
		options.projectDir,
		pptxPath,
		options.slideCount,
		skillDir,
	);

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
					`- 本任务已选择图片生成模型。规划阶段只在 design_spec.md §VIII 安排 1-${params.imageCountLimit || 1} 张真正有助于叙事的 Acquire Via: ai 父图，不得提前创建 images/image_prompts.json。`,
					"- 每个 ai 资源行使用安全的英文、数字、下划线或短横线文件名并以 .png 结尾；Reference 只写主体、意图与构图，不重复风格词或 HEX 色值，具体提示词由 Step 5 独立 Image_Generator 组装。",
					"- 图片数量上限只计算真正调用图片模型的父图。同一视觉家族需要 3 个以上小型点缀插画时，必须优先按官方 Illustration Sheet + slice 工作流合并为一张父图，不得把每个切片元素写成独立 ai 行。",
					"- 插画表在 design_spec.md 写一条 ai / Illustration Sheet 父行和逐个 slice 元素行；spec_lock.md 只列可放置的切片元素，不得列父插画表。Image_Generator 将在 Step 5 决定 slice_grid、slice_names 与完整提示词。",
					"- 第一阶段只完成 design_spec.md、spec_lock.md 与图片资源意图。不要创建图片 manifest，不要调用 image_gen.py、网页搜图或图片 API，不要生成 SVG 或导出 PPTX。",
					"- 官方图片路径锁定为 host-native；服务器将在最终设计确认后启动独立 Image_Generator，并补齐 image_prompts.json、image_prompts.md 与 image_analysis.csv。",
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
		`- 写入 design_spec.md 或 spec_lock.md 前，必须完整读取 ${skillDir}/references/strategist.md、${skillDir}/templates/design_spec_reference.md 和 ${skillDir}/templates/spec_lock_reference.md；宿主会校验实际 read 工具记录。`,
		"- 如果 analysis/source_index.json 存在，必须先读取它，再按其中 markdownPath 读取每份完整转换稿；如果 analysis/source_profile.json 存在，还必须读取该 PPTX intake 索引，并按需读取 identity 与 slide_library。",
			"- 用户已在站内表单确认画布、页数、受众、文字量、语气、模型和是否使用 AI 图片；这些是不可改写的硬约束。",
			"- 本站接管 PPT Master Step 4 的交互界面。不要启动 `confirm_ui/server.py`，不要等待本地网页，也不要在回复中向用户提问。",
			"- 必须把创意方向候选写入 analysis/hosted_confirmation.json。服务器会自动采用推荐项，或暂停任务交给用户选择。",
		"- `mode` 与 `visual_style` 必须使用官方目录 id。参数为 auto 时，先读对应 `_index.md` 后选择并锁定一个 id；参数非 auto 时直接锁定，不得改写为站内中文风格名。",
		"- 所有可见幻灯片文字必须使用简体中文。只有 AI、API、LLM、SaaS、PPTX 等无法自然翻译的产品名或技术缩写可以保留英文。",
		"- 本会话不得生成任何 SVG、notes、图片 manifest 或 PPTX；只允许完成内容简报、design_spec.md、spec_lock.md、设计候选和 §VIII 图片资源意图。",
		"- 在 design_spec.md 的逐页大纲中为每页指定明确的叙事职责、page_rhythm 和主构图家族，避免把所有页面规划成卡片阵列。",
		"- `spec_lock.md` 的 typography 段只允许字体族和不带单位的数字 px 字号；formula_policy 与 body_size_unit 只属于规划说明，不得写入该段。",
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
			"USER CONFIRMS: I approve the hosted constraints, split generation mode, and refine_spec=false. Produce the hosted creative recommendations without opening another Confirm UI or asking a question.",
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
			buildHostedPlanningRecommendationContract(
				options.slideCount,
				Boolean(params.imageModel),
			),
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
			"When design_spec.md, spec_lock.md, analysis/hosted_confirmation.json, and analysis/content_brief.md when required are complete, print a concise planning-complete line and stop.",
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
			"必须补齐并校验 analysis/hosted_confirmation.json，候选数量、字段和逐页计划必须符合 agent-task.md 的 Hosted Planning Recommendation Contract。",
		requiresContentBrief
			? "本任务资料较少，必须补齐 analysis/content_brief.md，明确事实边界、具体示例和逐页叙事职责。"
			: "本任务不要求额外生成 analysis/content_brief.md。",
		requiresImageManifest
			? `必须在 design_spec.md §VIII 规划 1-${params.imageCountLimit || 1} 张实际调用图片模型的 Acquire Via: ai 父图；Reference 只写主体、意图与构图。需要 3 个以上同家族小插画时使用一个 ai / Illustration Sheet 父行，并同步补齐 slice 元素行与 spec_lock.md 中的可放置切片元素。不得创建 images/image_prompts.json。`
			: "本任务未启用 AI 图片，不要创建图片生成清单。",
		"不要创建或修改图片 manifest，不要调用 image_gen.py、网页搜图或任何图片 API。规划文件齐全后立即结束本轮。",
	].join("\n");
}

function buildHostedPlanningRecommendationContract(
	slideCount: number,
	useAiImages: boolean,
) {
	return [
		"## Hosted Planning Recommendation Contract",
		"",
		"将以下结构写成严格 JSON 到 analysis/hosted_confirmation.json，不要使用 Markdown 代码块：",
		"- schema 固定为 ppt_hosted_planning_recommendations.v1；summary 为简体中文设计摘要。",
		"- directions 恰好 3 项（稳妥、适度变化、大胆），每项包含 id、label、mode、visualStyle、deliveryPurpose、rationale；mode 与 visualStyle 必须是官方参考目录 id，deliveryPurpose 只能为 text/balanced/presentation。",
		"- palettes 恰好 3 项，每项包含 id、label、background、secondaryBackground、primary、accent、bodyText、rationale；所有颜色必须是 #RRGGBB。",
		"- typography 恰好 3 项，每项包含 id、label、heading、body、bodySize、rationale；heading/body 是可直接写入 SVG 的完整字体栈，bodySize 是 16-40 的整数 px。",
		useAiImages
			? '- imageStrategies 恰好 3 项且每项包含 id、label、usage、rendering、palette、rationale；usage 必须是包含 "ai" 的 JSON 数组，例如 ["ai"] 或 ["ai", "provided"]，绝不能写成字符串；rendering/palette 使用官方图片参考 id。'
			: '- imageStrategies 提供 1-3 项且每项完整包含 id、label、usage、rendering、palette、rationale；不得包含 ai。usage 必须是 JSON 数组：有用户图片时写 ["provided"]，没有时写 ["none"]，绝不能写成字符串。没有图片时 rendering 与 palette 均写 "not-applicable"。',
		`- pagePlan 恰好 ${slideCount} 项，page 从 1 连续到 ${slideCount}；每项包含 page、title、purpose、rhythm、layoutFamily，rhythm 只能为 anchor/dense/breathing。`,
		"- recommendedDirectionId、recommendedPaletteId、recommendedTypographyId、recommendedImageStrategyId 必须引用各自候选中的 id。",
		"- 同一候选数组中的 id 不得重复；id 仅使用英文字母、数字、下划线和短横线。",
	].join("\n");
}

async function runHostedPlanningStageDerivation(input: {
	params: GenerationParams;
	options: RunnerOptions;
	skillDir: string;
	promptPath: string;
	piConfig: PreparedPiAgentConfig;
	stage: "design-system" | "execution";
	turn: number;
	requiresImageManifest: boolean;
}) {
	const { params, options, stage } = input;
	const draft = readPptPlanningDraft(options.projectDir);
	if (draft.nextStage !== stage) {
		throw new Error("PPT 分阶段确认草稿与当前恢复阶段不一致。");
	}
	const phaseProtection = createHostedPlanningDerivationProtection(options);
	await updateProject(
		params.projectId,
		{
			status: "STRATEGIZING",
			currentPhase:
				stage === "design-system"
					? "正在根据设计方向推导设计系统"
					: "正在根据设计系统推导图片与执行方案",
			progress: 30,
		},
		options.workerLease,
	);
	const command = resolveAgentCommand(
		params.projectId,
		options.projectDir,
		input.skillDir,
		input.promptPath,
		buildHostedPlanningStageDerivationPrompt(
			options,
			stage,
			input.requiresImageManifest,
		),
		buildPptPhaseSessionId(params.projectId, `planning-${stage}`),
		input.piConfig,
	);
	await emitProjectLog(
		params.projectId,
		options.emit,
		stage === "design-system"
			? "根据已确认方向启动独立设计系统推导会话"
			: "根据已确认设计系统启动独立图片与执行推导会话",
		options.workerLease,
	);
	await runProtectedAgentCommand(
		params.projectId,
		command,
		options,
		input.turn,
		phaseProtection,
		"PPT 规划推导",
	);
	const recommendations = assertPptPlanningRecommendations(options.projectDir, {
		expectedSlideCount: options.slideCount,
		allowAiImages: input.requiresImageManifest,
		skillDir: input.skillDir,
	});
	assertPptPlanningStageDerived(recommendations, draft, stage);
	return recommendations;
}

function buildHostedPlanningStageDerivationPrompt(
	options: RunnerOptions,
	stage: "design-system" | "execution",
	requiresImageManifest: boolean,
) {
	const stageInstructions =
		stage === "design-system"
			? [
					"- 读取 hosted_confirmation_draft.json 中用户已确认的 directionId，并从 hosted_confirmation.json 找到对应 direction。",
					"- 基于该 direction 的 mode、visualStyle、deliveryPurpose，以及完整资料，重新推导 3 套 palette 和 3 套 typography。不得沿用未确认方向产生的下游候选。",
					"- 保留 directions、imageStrategies 与 pagePlan；保留用户选中的 direction id。更新推荐 palette/typography id。",
					"- 写入 derivation={stage:\"design-system\",directionId:<已确认 id>,derivedAt:<ISO 时间>}。",
				]
			: [
					"- 读取 hosted_confirmation_draft.json 中用户已确认的 directionId、paletteId 与 typographyId，并从 hosted_confirmation.json 找到对应候选。",
					`- 基于这三项实际选择重新推导图片策略和逐页 pagePlan。${requiresImageManifest ? "必须给出 3 套使用 AI 的图片风格候选。" : "不得引入 AI 图片策略。"}`,
					"- 保留 directions、palettes、typography 以及已确认 id；更新推荐 imageStrategy id。pagePlan 必须保持目标页数，但节奏与构图职责要服从最终设计系统。",
					"- 写入 derivation={stage:\"execution\",directionId:<已确认 id>,paletteId:<已确认 id>,typographyId:<已确认 id>,derivedAt:<ISO 时间>}。",
				];
	return [
		"# PPT Master Hosted Staged Confirmation Derivation",
		"",
		"这是服务器托管的分阶段设计推导会话。只更新 analysis/hosted_confirmation.json，不进入 Executor。",
		"",
		"## Required Reads",
		"",
		`- ${options.projectDir}/sources/source.md`,
		`- ${options.projectDir}/analysis/hosted_confirmation.json`,
		`- ${options.projectDir}/analysis/hosted_confirmation_draft.json`,
		`- ${options.projectDir}/design_spec.md`,
		`- ${options.projectDir}/spec_lock.md`,
		"",
		"## Hard Requirements",
		"",
		...stageInstructions,
		"- hosted_confirmation.json 必须继续严格符合 ppt_hosted_planning_recommendations.v1，所有候选 id 唯一，recommended id 必须指向现有候选。",
		"- 不得修改资料、design_spec.md、spec_lock.md、确认草稿、图片清单、SVG、notes 或 exports。不得调用图片 API。",
		"- 写完 JSON 后立即结束，不要向用户提问。",
		"",
	].join("\n");
}

function buildPlanningRefinementPrompt(
	params: GenerationParams,
	options: RunnerOptions,
) {
	const recommendations = readPptPlanningRecommendations(options.projectDir);
	const decision = readPptPlanningResult(options.projectDir);
	const selected = resolvePptPlanningSelection(recommendations, decision);
	return [
		"# PPT Master Confirmed Planning Refinement",
		"",
		"这是独立的规划修订会话，不是 Executor。先读取 `.ppt-master-skill/SKILL.md`、design_spec.md、spec_lock.md、analysis/hosted_confirmation.json 和 analysis/hosted_confirmation_result.json。",
		"用户或服务器已经完成 Step 4 选择。必须按下面的选择重写 design_spec.md 与 spec_lock.md；不得生成 SVG、notes 或 PPTX，不得再次请求确认。",
		"",
		"## Confirmed Selection",
		"",
		"```json",
		JSON.stringify(selected, null, 2),
		"```",
		"",
		"## Hard Application Rules",
		"",
		"- spec_lock.md 必须写入选中 direction 的 mode 与 visual_style。",
		"- colors 必须至少使用精确键 bg、secondary_bg、primary、accent、text，并逐字写入选中色值。",
		"- typography 必须使用选中的 heading/body 字体栈，body 必须等于选中的 bodySize；其余字号按官方比例推导。",
		`- page_rhythm 必须包含 P01 到 P${String(options.slideCount).padStart(2, "0")}，逐页值与 pagePlan 完全一致。`,
		"- design_spec.md 的逐页大纲必须保持 pagePlan 的标题、职责、节奏和主构图家族，同时补足具体内容；不得把不同构图重新改成统一卡片公式。",
		selected.imageStrategy.usage.includes("ai")
			? "- colors 中写入精确的 image_rendering 与 image_palette；按最终逐页用途修订 design_spec.md §VIII 的 ai 资源意图、page_role 与 text_policy。保留并校验 Illustration Sheet 父行、slice 元素行，以及 spec_lock.md 中仅包含可放置切片元素的契约；不得创建或修改 images/image_prompts.json。"
			: "- 删除设计规范中对 AI 图片的依赖；仅可使用用户提供的项目图片或无图片方案。",
		"- 保留来源事实、受众和内容边界，不得在修订设计时增加无来源数据。",
		"- spec_lock.md 只能包含可执行数据，不得复制模板中的说明块或占位值。",
		`- 图片模型选择：${params.imageModel || "未启用"}。`,
		"完成两个规范文件修订后，输出 planning-refinement-complete 并停止。",
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
		"确认 design_spec.md 和 spec_lock.md 存在，然后读取它们；如果 analysis/content_brief.md、analysis/source_index.json 或 analysis/source_profile.json 存在也必须读取。生成具体页面内容时重新读取 sources/source.md，不能只依赖大纲摘要。",
		hasGeneratedImages
			? "服务器已完成图片生成。读取 images/image_prompts.json、images/image_prompts.md 和 analysis/image_analysis.csv；只使用 status=Generated 且文件实际存在的图片，不得重新生成、搜索或替换图片。"
			: "本任务未启用 AI 图片。只可使用项目内已有用户图片；没有可用图片时使用文字、原生图形、图表和留白完成叙事。",
		hasGeneratedImages
			? "status=Needs-Manual 的图片视为不可用：移除页面对它们的依赖，不得保留缺图占位框。"
			: "不要创建图片生成任务，不要调用 image_gen.py 或 image_search.py。",
		hasGeneratedImages
			? "Illustration Sheet 父图只用于服务器切片，绝不能放到页面；切片元素以 design_spec.md VIII 的 slice 行及 images/image_prompts.json 的 derived_items 状态为准。"
			: "",
		"不要读取或请求任何 API Key。不得改写 design_spec.md、spec_lock.md 或图片清单；不可用图片只需在页面执行时忽略，不得改变已确认规划。",
		"spec_lock.md 的 typography 段必须只包含字体族和不带单位的数字 px 字号，不得加入 formula_policy、body_size_unit 或其他规划元数据。",
		"进入 Executor 前读取 .ppt-master-skill/references/executor-base.md、.ppt-master-skill/references/shared-standards.md、spec_lock.md 锁定的 .ppt-master-skill/references/modes/ 与 .ppt-master-skill/references/visual-styles/ 文件、.ppt-master-skill/references/image-layout-spec.md 和 .ppt-master-skill/references/svg-image-embedding.md。",
		`从第 1 页开始逐页生成 svg_output/*.svg，目标 ${options.slideCount} 页；每页前重新读取 spec_lock.md。`,
		"不得写脚本批量生成 SVG，不得生成占位页，不得跳过页面。",
		buildHostedCompositionQualityContract(options.slideCount),
		"完成全部页面和 notes/total.md 后运行质量检查并修复，然后立即停止本轮。不要执行 Step 7，不要运行 total_md_split.py、finalize_svg.py 或 svg_to_pptx.py；服务器将在图表校准和可选视觉复核后统一导出。",
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
	resetOutputDirectory(join(options.projectDir, ".review"));
	const slides = await renderPptSlidesForVisualReview({
		projectDir: options.projectDir,
		aspectRatio: options.aspectRatio,
	});
	const batches = batchPptVisualReviewSlides(slides);
	const allBackups = backupPptVisualReviewSlides(options.projectDir, slides);
	const backupBySvg = new Map(
		allBackups.map((backup) => [backup.svgPath, backup]),
	);
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
		const reportPath = join(
			options.projectDir,
			".review",
			`batch-${String(batchIndex + 1).padStart(2, "0")}.md`,
		);
		const reviewProtection = createVisualReviewPhaseProtection(
			options,
			batch.map((slide) => slide.svgPath),
			reportPath,
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
			const reviewed = await runProtectedAgentCommand(
				params.projectId,
				command,
				options,
				input.firstReviewTurn + batchIndex,
				reviewProtection,
				"PPT 视觉复核",
			);
			assertPptVisualReviewImagesRead(reviewed.output, batch);
			if (!existsSync(reportPath) || statSync(reportPath).size < 1) {
				throw new Error("视觉复核没有生成本批报告");
			}
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
			restorePptVisualReviewSlides(
				batch
					.map((slide) => backupBySvg.get(slide.svgPath))
					.filter((backup): backup is NonNullable<typeof backup> => Boolean(backup)),
			);
			throwIfPptCancelled(options.signal);
			const failureReason = getVisualReviewFailureReason(error);
			await renderPptSlidesForVisualReview({
				projectDir: options.projectDir,
				aspectRatio: options.aspectRatio,
				svgFiles: batch.map((slide) => slide.svgFile),
			});
			writeFileSync(
				reportPath,
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

async function runHostedChartVerification(input: {
	params: GenerationParams;
	options: RunnerOptions;
	skillDir: string;
	promptPath: string;
	piConfig: PreparedPiAgentConfig;
	firstVerificationTurn: number;
	sessionPhase?: string;
}) {
	const { params, options } = input;
	const references = listPptVisualizationReferences(options.projectDir);
	const dataReferences = listPptDataChartReferences(options.projectDir);
	if (dataReferences.length === 0) {
		writePptChartVerificationEvidence(options.projectDir, "");
		return;
	}
	throwIfPptCancelled(options.signal);
	await updateProject(
		params.projectId,
		{
			status: "EXECUTING",
			currentPhase: "正在校准图表坐标",
			progress: 80,
		},
		options.workerLease,
	);
	options.emit({ type: "progress", data: { progress: 80 } });
	await emitProjectLog(
		params.projectId,
		options.emit,
		`开始官方 verify-charts 独立校准：§VII 共 ${references.length} 个可视化引用`,
		options.workerLease,
	);

	const requestProtection = createChartVerificationPhaseProtection(
		options,
		"request",
		dataReferences,
	);
	let previous = await runProtectedAgentCommand(
		params.projectId,
		resolveAgentCommand(
			params.projectId,
			options.projectDir,
			input.skillDir,
			input.promptPath,
			buildHostedChartCalculatorRequestPrompt(options, input.skillDir),
			buildPptPhaseSessionId(
				params.projectId,
				input.sessionPhase || "chart-verification",
			),
			input.piConfig,
		),
		options,
		input.firstVerificationTurn,
		requestProtection,
		"图表请求阶段",
	);
	let lastError: unknown;
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		throwIfPptCancelled(options.signal);
		await executePptChartCalculatorRequests(options.projectDir, input.skillDir);
		const comparisonProtection = createChartVerificationPhaseProtection(
			options,
			"comparison",
			dataReferences,
		);
		previous = await runProtectedAgentCommand(
			params.projectId,
			resolveAgentCommand(
				params.projectId,
				options.projectDir,
				input.skillDir,
				input.promptPath,
				buildHostedChartComparisonPrompt(options, attempt, lastError),
				previous.sessionId,
				input.piConfig,
			),
			options,
			input.firstVerificationTurn + (attempt - 1) * 2 + 1,
			comparisonProtection,
			"图表比较阶段",
		);

		const calculatorResults = await executePptChartCalculatorRequests(
			options.projectDir,
			input.skillDir,
		);
		const receiptProtection = createChartVerificationPhaseProtection(
			options,
			"receipt",
			dataReferences,
		);
		previous = await runProtectedAgentCommand(
			params.projectId,
			resolveAgentCommand(
				params.projectId,
				options.projectDir,
				input.skillDir,
				input.promptPath,
				buildHostedChartFinalReceiptPrompt(options),
				previous.sessionId,
				input.piConfig,
			),
			options,
			input.firstVerificationTurn + (attempt - 1) * 2 + 2,
			receiptProtection,
			"图表最终回执阶段",
		);
		try {
			assertPptChartCalculatorResults(options.projectDir);
			writePptChartVerificationEvidence(
				options.projectDir,
				previous.resultText || previous.output,
				calculatorResults,
			);
			lastError = null;
			break;
		} catch (error) {
			lastError = error;
			if (attempt === 2) throw error;
			await emitProjectLog(
				params.projectId,
				options.emit,
				`图表计算或校准回执不完整，继续同一会话修正：${getPptInternalErrorMessage(error)}`,
				options.workerLease,
			);
		}
	}
	resetOutputDirectory(join(options.projectDir, "exports"));
	await emitProjectLog(
		params.projectId,
		options.emit,
		"图表坐标校准完成，最终 PPTX 将由服务器重新导出",
		options.workerLease,
	);
}

function buildHostedChartCalculatorRequestPrompt(
	options: RunnerOptions,
	skillDir: string,
) {
	return [
		"# PPT Master Hosted Chart Calculator Request",
		"",
		"在全新独立会话中启动官方 `workflows/verify-charts.md`。PI 环境不直接执行坐标计算器；先把每页所需命令写成宿主可验证请求。",
		"",
		"## Hard Requirements",
		"",
		`- 先阅读 ${skillDir}/SKILL.md、${skillDir}/workflows/verify-charts.md 和其中引用的图表规则。`,
		`- 项目目录：${options.projectDir}`,
		"- 以 design_spec.md §VII 为权威清单，并与 §IX 对照；区分数据驱动图表和结构型信息图。",
		"- 读取每个数据驱动图表的实际 SVG、chart-plot-area、数据、刻度、局部 transform 和必要几何参数。",
		`- 写入 ${getPptChartCalculatorRequestsPath(options.projectDir)}，schema 必须为 ppt_hosted_chart_calculator_requests.v1。`,
		"- requests 必须对每个数据驱动图表恰好一项，字段为 id、page、template、verificationMode、commands、rationale。direct 图必须 direct-calc；formula/manual 图保持官方固定分类；decomposable 或 partial 图仅在官方 recipe 无法可靠拆解时才可降级为 manual-verify，并在 rationale 明确具体原因。",
		"- 每条 commands 项为 {calculator,args}。calculator 仅可为 bar/line/pie/radar；args 必须是直接传给官方脚本的参数数组，例如 [\"calc\",\"bar\",\"--data\",\"A:10,B:20\",\"--area\",\"100,100,700,500\",\"--value-range\",\"0,100\"]。",
		"- verificationMode 为 direct-calc/decomposable-calc/partial-calc 时至少一个计算命令；formula-verify/manual-verify 时 commands 必须为空，并在 rationale 写清公式或逐项人工核对依据。",
		"- 当前阶段不得修改 SVG，不得伪造计算输出，不得尝试运行 svg_position_calculator.py，不得输出 verify-charts 回执。写完请求立即结束。",
		"- 不得修改 design_spec.md、spec_lock.md、资料、图片、讲稿或 exports/。",
		"",
	].join("\n");
}

function buildHostedChartComparisonPrompt(
	options: RunnerOptions,
	attempt: number,
	error: unknown,
) {
	return [
		"# PPT Master Hosted Chart Comparison",
		"",
		`宿主已真实执行官方 svg_position_calculator.py，结果位于 ${getPptChartCalculatorResultsPath(options.projectDir)}。`,
		attempt > 1 ? `上一轮问题：${getPptInternalErrorMessage(error)}` : "",
		"逐页读取计算结果与 SVG，按官方工作流处理局部坐标和刻度后比较。仅在尺度一致且坐标确有偏差时手工修正对应 SVG。公式型和人工型页面按 rationale 完成核对。",
		"修正后必须重新读取最终 SVG，并覆盖 chart-calculator-requests.json，写入针对最终几何的完整计算请求。即使本轮无需修正，也要保留并核实完整请求。",
		"每个数据图表页必须保留合法 chart-plot-area 标记；支持原生图表的类型保留 data-pptx-native=\"chart\" 元数据。",
		"不得修改宿主计算结果 JSON、design_spec.md、spec_lock.md、资料、图片或讲稿；不得运行导出脚本，不得写入 exports/。当前先不要输出 verify-charts 回执。",
	]
		.filter(Boolean)
		.join("\n");
}

function buildHostedChartFinalReceiptPrompt(options: RunnerOptions) {
	return [
		"# PPT Master Hosted Chart Final Receipt",
		"",
		`宿主已对最终请求再次执行官方计算器。读取 ${getPptChartCalculatorResultsPath(options.projectDir)}，并逐页与当前 SVG 做最后只读比较。`,
		"本阶段不得修改任何文件。若仍不匹配，明确报告失败且不要输出通过回执。",
		"只有全部匹配时，最终回答才为每个数据驱动图表恰好输出一行 `verify-charts: <svg 文件名> | mode=<verificationMode> | request=<计算请求 id> | scale=<实际核对尺度或 manual> | result=<match 或 verified>`。计算器页使用 result=match，公式型或人工型页面使用 result=verified。不要合并页面，不要省略任何页面。",
	].join("\n");
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

function createInitialAgentPhaseProtection(
	params: GenerationParams,
	options: RunnerOptions,
): PptAgentPhaseProtection {
	const templateDecisionPath = getPptTemplateFillDecisionPath(options.projectDir);
	const hostOwnedPaths = [
		getPptPlanningDecisionPath(options.projectDir),
		getPptPlanningDraftPath(options.projectDir),
		templateDecisionPath,
		getPptStrategistEvidencePath(options.projectDir),
		getPptImagePromptEvidencePath(options.projectDir),
	];
	for (const path of hostOwnedPaths) {
		const preserveConfirmedTemplateDecision =
			options.workflow === "template-fill" &&
			Boolean(params.planningConfirmed) &&
			path === templateDecisionPath;
		if (!preserveConfirmedTemplateDecision) {
			rmSync(path, { recursive: true, force: true });
		}
	}
	const manifestPath = join(options.projectDir, "images", "image_prompts.json");
	if (options.workflow === "svg") {
		for (const path of [
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			getPptPlanningRecommendationsPath(options.projectDir),
			join(options.projectDir, "analysis", "content_brief.md"),
			manifestPath,
			join(options.projectDir, "images", "image_prompts.md"),
		]) {
			rmSync(path, { recursive: true, force: true });
		}
	}
	const awaitingTemplateConfirmation =
		options.workflow === "template-fill" &&
		Boolean(params.confirmDesign) &&
		!params.planningConfirmed;
	if (options.workflow === "svg") {
		clearPrematureSlideOutputs(options.projectDir);
	}
	if (awaitingTemplateConfirmation) {
		resetOutputDirectory(join(options.projectDir, "exports"));
	}
	return {
		files: snapshotFileStates([
			...hostOwnedPaths,
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				...(options.workflow === "svg"
					? [
							"svg_output",
							"svg_final",
							"notes",
							"exports",
							"validation",
							".preview",
							".review",
						]
					: []),
				...(awaitingTemplateConfirmation ? ["exports"] : []),
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "images"), {
				allowChangesTo: [],
			}),
			...(options.workflow === "svg"
				? [
						snapshotDirectoryTreeFiles(
							join(options.projectDir, "analysis"),
							{
								allowChangesTo: [
									getPptPlanningRecommendationsPath(options.projectDir),
									join(
										options.projectDir,
										"analysis",
										"content_brief.md",
									),
								],
							},
						),
					]
				: []),
		],
		rollbackFiles:
			options.workflow === "svg"
				? snapshotFileStates([
						join(options.projectDir, "design_spec.md"),
						join(options.projectDir, "spec_lock.md"),
						getPptPlanningRecommendationsPath(options.projectDir),
						join(options.projectDir, "analysis", "content_brief.md"),
					])
				: [],
	};
}

function createHostedPlanningDerivationProtection(
	options: RunnerOptions,
): PptAgentPhaseProtection {
	return {
		files: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				"images",
				"svg_output",
				"svg_final",
				"notes",
				"exports",
				"validation",
				".preview",
				".review",
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "analysis"), {
				allowChangesTo: [getPptPlanningRecommendationsPath(options.projectDir)],
			}),
		],
		rollbackFiles: snapshotFileStates([
			getPptPlanningRecommendationsPath(options.projectDir),
		]),
	};
}

function createPlanningRefinementProtection(
	options: RunnerOptions,
): PptAgentPhaseProtection {
	return {
		files: snapshotFileStates([join(options.projectDir, "agent-task.md")]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				"analysis",
				"svg_output",
				"svg_final",
				"notes",
				"exports",
				"validation",
				".preview",
				".review",
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "images")),
		],
		rollbackFiles: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
		]),
	};
}

function createImagePromptPlanningProtection(
	options: RunnerOptions,
): PptAgentPhaseProtection {
	const manifestPath = join(options.projectDir, "images", "image_prompts.json");
	const evidencePath = getPptImagePromptEvidencePath(options.projectDir);
	return {
		files: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				".ppt-master-skill",
				"svg_output",
				"svg_final",
				"notes",
				"exports",
				"validation",
				".preview",
				".review",
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "images"), {
				allowChangesTo: [manifestPath],
			}),
			snapshotDirectoryTreeFiles(join(options.projectDir, "analysis"), {
				allowChangesTo: [evidencePath],
			}),
		],
		rollbackFiles: snapshotFileStates([manifestPath, evidencePath]),
	};
}

function createExecutorPhaseProtection(
	options: RunnerOptions,
): PptAgentPhaseProtection {
	return {
		files: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				"analysis",
				"images",
				"exports",
				"svg_final",
				".preview",
				".review",
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "notes"), {
				allowChangesTo: [join(options.projectDir, "notes", "total.md")],
			}),
		],
	};
}

function createVisualReviewPhaseProtection(
	options: RunnerOptions,
	batchSvgPaths: string[],
	reportPath: string,
): PptAgentPhaseProtection {
	const validationDirectory = join(options.projectDir, "validation");
	mkdirSync(validationDirectory, { recursive: true });
	return {
		files: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				"analysis",
				"images",
				"notes",
				"exports",
				"svg_final",
				".preview",
			]),
			snapshotDirectoryTreeFiles(validationDirectory),
			snapshotDirectoryTreeFiles(join(options.projectDir, ".review"), {
				allowChangesTo: [reportPath],
			}),
			snapshotDirectoryFiles(join(options.projectDir, "svg_output"), {
				allowChangesTo: batchSvgPaths,
			}),
		],
	};
}

function createChartVerificationPhaseProtection(
	options: RunnerOptions,
	phase: "request" | "comparison" | "receipt",
	dataReferences: ReturnType<typeof listPptDataChartReferences>,
): PptAgentPhaseProtection {
	const requestPath = getPptChartCalculatorRequestsPath(options.projectDir);
	const svgDirectory = join(options.projectDir, "svg_output");
	const allowedSvgPaths =
		phase === "comparison"
			? dataReferences.map((reference) => {
					const file = findPptSvgFileByPage(
						options.projectDir,
						reference.page,
					);
					if (!file) {
						throw new Error(
							`PPT 图表页 P${String(reference.page).padStart(2, "0")} 缺少 SVG 文件。`,
						);
					}
					return join(svgDirectory, file);
				})
			: [];
	const validationDirectory = join(options.projectDir, "validation");
	mkdirSync(validationDirectory, { recursive: true });
	return {
		files: snapshotFileStates([
			join(options.projectDir, "design_spec.md"),
			join(options.projectDir, "spec_lock.md"),
			join(options.projectDir, "agent-task.md"),
		]),
		directories: [
			...snapshotProjectDirectoryTrees(options.projectDir, [
				"sources",
				"templates",
				"images",
				"notes",
				"exports",
				"svg_final",
			]),
			snapshotDirectoryTreeFiles(join(options.projectDir, "analysis"), {
				allowChangesTo: phase === "receipt" ? [] : [requestPath],
			}),
			snapshotDirectoryTreeFiles(validationDirectory),
			snapshotDirectoryFiles(svgDirectory, {
				allowChangesTo: allowedSvgPaths,
			}),
		],
		rollbackFiles:
			phase === "receipt"
				? []
				: snapshotFileStates([requestPath, ...allowedSvgPaths]),
	};
}

function snapshotProjectDirectoryTrees(projectDir: string, names: string[]) {
	return names.map((name) =>
		snapshotDirectoryTreeFiles(join(projectDir, name)),
	);
}

async function runProtectedAgentCommand(
	projectId: string,
	command: AgentCommand,
	options: RunnerOptions,
	turn: number,
	protection: PptAgentPhaseProtection | null,
	operationName: string,
) {
	if (!protection) return runCommand(projectId, command, options, turn);
	return runWithProtectedFileGuard(
		() => runCommand(projectId, command, options, turn),
		protection.files,
		protection.directories,
		operationName,
		{ rollbackFilesOnFailure: protection.rollbackFiles },
	);
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
	for (const name of [
		"svg_output",
		"svg_final",
		"notes",
		"exports",
		"validation",
		".preview",
		".review",
	]) {
		resetOutputDirectory(join(projectDir, name));
	}
}

function resetOutputDirectory(path: string) {
	if (existsSync(path)) rmSync(path, { recursive: true, force: true });
	mkdirSync(path, { recursive: true });
}

async function runHostedImagePromptPlanning(input: {
	params: GenerationParams;
	options: RunnerOptions;
	skillDir: string;
	promptPath: string;
	piConfig: PreparedPiAgentConfig;
	firstTurn: number;
}) {
	const { params, options } = input;
	const maxImages = Math.max(1, Math.min(8, params.imageCountLimit || 1));
	try {
		assertPptImagePromptEvidence(options.projectDir, maxImages, input.skillDir);
		await emitProjectLog(
			params.projectId,
			options.emit,
			"已复用通过官方维度读取校验的图片提示词清单",
			options.workerLease,
		);
		return;
	} catch {
		// Missing or stale evidence is rebuilt in a fresh Image_Generator session.
	}

	throwIfPptCancelled(options.signal);
	await updateProject(
		params.projectId,
		{
			status: "ACQUIRING_IMAGES",
			currentPhase: "正在按最终设计组装图片提示词",
			progress: 34,
		},
		options.workerLease,
	);
	options.emit({
		type: "phase",
		data: { phase: "ACQUIRING_IMAGES", progress: 34 },
	});
	await emitProjectLog(
		params.projectId,
		options.emit,
		"启动独立 Image_Generator 会话，读取最终渲染、色板和逐图构图模板",
		options.workerLease,
	);

	const manifestPath = join(options.projectDir, "images", "image_prompts.json");
	const evidencePath = getPptImagePromptEvidencePath(options.projectDir);
	const protection = createImagePromptPlanningProtection(options);
	await runWithProtectedFileGuard(
		async () => {
			rmSync(manifestPath, { force: true });
			rmSync(evidencePath, { force: true });
			let previous = emptyCommandResult();
			let lastError: unknown;
			const toolCalls: PptAgentToolCall[] = [];
			let toolCaptureComplete = true;
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				throwIfPptCancelled(options.signal);
				const command = resolveAgentCommand(
					params.projectId,
					options.projectDir,
					input.skillDir,
					input.promptPath,
					buildHostedImagePromptPlanningPrompt(
						options,
						input.skillDir,
						maxImages,
						attempt,
						lastError,
					),
					attempt === 1
						? buildPptPhaseSessionId(params.projectId, "image-generator")
						: previous.sessionId,
					input.piConfig,
				);
				previous = await runCommand(
					params.projectId,
					command,
					options,
					input.firstTurn + attempt - 1,
				);
				appendPptToolCalls(toolCalls, previous.toolCalls);
				toolCaptureComplete &&= previous.toolCaptureComplete;
				try {
					writePptImagePromptEvidence(
						options.projectDir,
						input.skillDir,
						toolCalls,
						maxImages,
						toolCaptureComplete,
					);
					await emitProjectLog(
						params.projectId,
						options.emit,
						"图片提示词已按官方 rendering、palette 与 type 契约完成组装",
						options.workerLease,
					);
					return;
				} catch (error) {
					lastError = error;
					rmSync(evidencePath, { force: true });
					if (attempt < 3) {
						await emitProjectLog(
							params.projectId,
							options.emit,
							`图片提示词契约未通过，第 ${attempt + 1} 轮继续修正：${getPptInternalErrorMessage(error)}`,
							options.workerLease,
						);
					}
				}
			}
			throw new Error(
				`PPT Image_Generator 未能生成有效图片提示词清单：${getPptInternalErrorMessage(lastError)}`,
			);
		},
		protection.files,
		protection.directories,
		"PPT Image_Generator",
		{ rollbackFilesOnFailure: protection.rollbackFiles },
	);
}

function buildHostedImagePromptPlanningPrompt(
	options: RunnerOptions,
	skillDir: string,
	maxImages: number,
	attempt: number,
	previousError: unknown,
) {
	return [
		"# PPT Master Image_Generator Prompt Assembly",
		"",
		"这是官方 Step 5 的独立 Image_Generator 会话。最终设计已经确认；只负责把 design_spec.md §VIII 的 Acquire Via: ai 资源意图组装成图片 manifest，不调用任何图片 API。",
		attempt > 1
			? `上一轮宿主校验失败：${getPptInternalErrorMessage(previousError)}。必须重新读取所需文件并再次 write/edit 最终 manifest。`
			: "",
		"",
		"## Required Reads Before Final Write",
		"",
		`- ${skillDir}/SKILL.md`,
		`- ${skillDir}/references/image-base.md`,
		`- ${skillDir}/references/image-generator.md`,
		`- ${skillDir}/references/image-renderings/_index.md`,
		`- ${skillDir}/references/image-palettes/_index.md`,
		`- ${skillDir}/references/image-type-templates/_index.md`,
		`- ${options.projectDir}/design_spec.md`,
		`- ${options.projectDir}/spec_lock.md`,
		"- 从 spec_lock.md 读取最终 image_rendering 与 image_palette。值不是 custom 时，只读取各自选中的 rendering/palette 文件；值为 custom 时使用对应 behavior。",
		"- 对每个 page_role=local 的普通图片，从 type 索引选择一个官方 type，并在最终写入前完整读取对应 type 文件。hero_page 与 Illustration Sheet 不选择 type。",
		"",
		"## Manifest Contract",
		"",
		`- 只写 ${options.projectDir}/images/image_prompts.json；items 必须与 design_spec.md §VIII 中 Acquire Via: ai 的父资源逐项对应，数量不得超过 ${maxImages}。`,
		"- 使用 image-generator.md §6 官方 schema：顶层写 deck_rendering、deck_palette，以及逐键对应最终设计锁的 color_scheme.primary/secondary/accent；每项写 filename、purpose、page_role、text_policy、aspect_ratio、prompt、status，普通 local 项另写官方字段 type。不要写 image_type。",
		"- hero_page 必须省略 type，使用 §4.1 单主体、人物、文字主视觉、氛围背景或明确 custom primitive；普通 local 必须使用 11 个官方 type 之一。",
		"- 每个 prompt 必须是一个连贯场景段落，按 §4 顺序组合：选中 rendering 行为、选中 palette 对最终 HEX 的比例分配、type/hero 构图、具体主体、容器用途与硬规则。例子只能帮助理解，不能复制成固定模板。",
		"- 每个 prompt 使用最终设计锁中的至少三个精确 HEX 色值，并说明颜色比例或职责；HEX 只是渲染指导，不得作为画面文字。常规提示词按官方 150-300 words 深度，且不得少于 240 个字符；专业领域图按 §4.2 充分展开。",
		"- text_policy=none 时明确禁止可见文字、字母、数字、标签、Logo 和水印；text_policy=embedded 时写出需要烘焙且不会编辑的精确字符，长正文与数据仍留给 SVG。",
		"- Illustration Sheet 项固定 page_role=local、text_policy=none，省略 type，写入与 slice 元素行一一对应的 slice_grid 和 slice_names；提示词明确 RxC 网格、独立单元、清晰沟槽、目标 cell 形状、单色背景和可切片约束。",
		"- 所有项初始 status=Pending。不得调用 bash，不得生成图片，不得写 image_prompts.md，不得修改 design_spec.md、spec_lock.md 或其他文件。",
		"- 完整读取全部实际使用的参考文件后，再通过 write/edit 工具写入最终 JSON；写完立即停止。",
		"",
	]
		.filter(Boolean)
		.join("\n");
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
	assertPptImagePromptEvidence(options.projectDir, maxImages, skillDir);
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
		skillDir,
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

	const imageUnitCreditCost = Math.max(
		0,
		Math.floor(params.imageUnitCreditCost || 0),
	);
	const textCreditsCost = Math.max(
		0,
		Math.floor(
			params.textCreditsCost ??
				(params.modelSource === "platform"
					? options.slideCount * getPptCreditsPerSlide()
					: 0),
		),
	);
	const targetCreditsCost =
		textCreditsCost + generated.billableCount * imageUnitCreditCost;
	const refundedCredits = await reconcilePptProjectCredits(
		params.projectId,
		targetCreditsCost,
		`PPT 配图未调用额度退款（${maxImages - generated.billableCount} 张）`,
		options.workerLease,
	);
	if (refundedCredits > 0) {
		await emitProjectLog(
			params.projectId,
			options.emit,
			`已退回未使用的 PPT 配图预留积分 ${refundedCredits}`,
			options.workerLease,
		);
	}
	const sliceSummary =
		generated.slicedCount > 0 || generated.sliceFailedCount > 0
			? `；切片成功 ${generated.slicedCount} 个${generated.sliceFailedCount > 0 ? `，失败 ${generated.sliceFailedCount} 个` : ""}`
			: "";
	await emitProjectLog(
		params.projectId,
		options.emit,
		generated.failedCount > 0
			? `PPT 配图生成完成：可用 ${generated.generatedCount} 张，重试后仍失败 ${generated.failedCount} 张${sliceSummary}；已自动降级继续`
			: `PPT 配图生成完成：${generated.generatedCount} 张${sliceSummary}`,
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
	const awaitingFillPlanConfirmation =
		Boolean(params.confirmDesign) && !params.planningConfirmed;
	const resumingConfirmedFillPlan =
		Boolean(params.confirmDesign) && Boolean(params.planningConfirmed);
	const confirmationRequirements = awaitingFillPlanConfirmation
		? [
				"- 本任务启用了模板填充方案确认。先生成完整 draft 方案并做容量检查，然后停止等待服务器页面确认。",
				"- fill_plan.json 的 status 必须保持 draft。不得运行 apply、不得写入 exports/、不得自行把状态改为 confirmed。",
			]
		: resumingConfirmedFillPlan
			? [
					`- 用户已确认页面方案。先读取 ${getPptTemplateFillDecisionPath(options.projectDir)} 与现有 draft fill_plan.json。`,
					"- 按 decision.slides 的数组顺序重排输出；每项 sourceSlide 是该输出页必须使用的模板源页。重复 sourceSlide 表示用户明确批准复用。",
					"- 根据最终源页重新生成匹配的 replacements、edits 与 layout_rationale；每页写 hosted_plan_index=<decision.planIndex>，再把 status 设为 confirmed。",
					"- 必须重新运行 check-plan 并消除全部 error，随后才可 apply。不得忽略或覆盖用户确认的页面映射。",
				]
			: [
					"- 用户未启用模板方案确认，服务器自动采用 agent 推荐的页面选择、复用和顺序。方案检查通过后可把 status 设为 confirmed 并直接应用。",
				];
	const requiredExecution = awaitingFillPlanConfirmation
		? [
				`1. 使用 ${skillDir}/scripts/template_fill_pptx.py analyze 分析 ${options.nativeTemplatePath}，输出 analysis/slide_library.json。`,
				"2. 阅读完整 slide library 和 `sources/source.md`，按目标叙事与版式容量手工编写 status=draft 的 `analysis/fill_plan.json`。",
				"3. 运行 `check-plan` 并把报告写到 `analysis/check_report.json`；修复全部 error，并尽量消除容量 warning。",
				"4. 确认 draft 方案和检查报告完整后立即结束。不要 apply，不要 validate，不要写 exports/。",
			]
		: [
				`1. 使用 ${skillDir}/scripts/template_fill_pptx.py analyze 分析 ${options.nativeTemplatePath}，输出 analysis/slide_library.json。`,
				resumingConfirmedFillPlan
					? "2. 读取用户确认决定并重写 `analysis/fill_plan.json`，严格应用确认顺序和 sourceSlide 映射，status 设为 confirmed。"
					: "2. 阅读完整 slide library 和 `sources/source.md`，按目标叙事与版式容量手工编写 status=confirmed 的 `analysis/fill_plan.json`。",
				"3. 运行 `check-plan` 并把报告写到 `analysis/check_report.json`；修复全部 error，并尽量消除容量 warning。",
				"4. 运行 `apply`，输出到 `exports/generated.pptx`，使用 `--transition keep` 保留模板原有转场。",
				"5. 运行 `template_fill_pptx.py validate <project path>`，生成 `validation/readback.md` 与 `validation/validate_report.json`，修复全部回读 error。",
				"6. 确认 `exports/` 中存在最终可编辑 PPTX 后再结束。",
			];
	return [
		"# PPT Master Native Template Fill Task",
		"",
		"你是服务器内置的 PPT Master 执行 agent。本任务必须执行 `workflows/template-fill-pptx.md` 原生模板填充工作流，不得进入主 SVG 生成流程。",
		"",
			"## Hard Requirements",
			"",
			"- 先阅读 PPT Master SKILL.md 和 `workflows/template-fill-pptx.md`，再执行命令。",
			...confirmationRequirements,
		"- 禁止运行 `pptx_to_svg.py`、`pptx_template_import.py`、`finalize_svg.py` 或 `svg_to_pptx.py`。",
		"- 必须直接克隆原生幻灯片并修改 OOXML，保留模板母版、布局、图片、形状、图表、表格、字体、动画和空间关系。",
		"- 模板视觉是唯一视觉依据，不得用站内风格预设覆盖或重新设计模板。",
		`- 最终输出严格为 ${options.slideCount} 页；模板页面不足时选择合适的内容页重复使用，但每次填入不同内容。`,
			`- fill_plan.json 的 schema 必须为 template_fill_pptx_plan.v1，status 必须为 ${awaitingFillPlanConfirmation ? "draft" : "confirmed"}；每页 source_slide 必须存在于 slide_library，purpose 与 layout_rationale 三个字段必须完整，禁止使用 --force 绕过确认状态。`,
		"- 每个选中源页的非空文字槽位都必须在 replacements 中明确替换或清空；同一源页重复使用时，purpose 和替换内容必须不同。表格或图表存在时必须填写对应 edits，不能让模板示例数据原样透出。",
		"- 所有需要替换的模板示例文案必须替换完整，不得残留无关标题、正文、年份、广告、下载站署名或英文口号。",
		"- 所有可见幻灯片文字使用简体中文，必要的产品名和技术缩写除外。",
		"- 文案必须适配原占位区域容量。标题过长先改写，正文过长先压缩或拆到其他模板页，不得通过极小字号硬塞。",
		"- 每个事实只能来自 `sources/source.md`；资料不足时保持概括，不得编造数据、机构、案例或来源。",
		"- 只允许写入当前项目目录。缺少依赖或模板不可解析时明确失败，不得生成假文件。",
		"",
			"## Required Execution",
			"",
			...requiredExecution,
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
			awaitingFillPlanConfirmation
				? "完成 draft fill plan 与 check report 后只需简要报告方案已准备，禁止声称 PPTX 已生成。"
				: "完成后只需简要报告最终 PPTX 路径和实际页数。",
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
	params: GenerationParams,
) {
	if (options.workflow === "template-fill") {
		return buildTemplateFillContinuePrompt(projectDir, turn, previous, params);
	}

	const svgCount = countSvgSlides(projectDir);
	const nextSlide = Math.min(svgCount + 1, options.slideCount);
	const interruptedByToolUse = previous.stopReason === "tool_use";

	if (svgCount >= options.slideCount) {
		return [
			"确认继续。当前目标页数的 SVG 页面已经生成，请不要重新开始，也不要重写已有 SVG。",
			"完成 notes/total.md 并运行 svg_quality_checker.py；修复全部 error 后立即停止。不要执行 Step 7，不要运行 total_md_split.py、finalize_svg.py 或 svg_to_pptx.py。",
			"不要请求确认，也不要自行启动 visual_review.py 或 live-preview server；图表校准、可选视觉复核和最终导出由服务器接管。",
		].join("\n");
	}

	if (svgCount > 0) {
		return [
			"确认继续。不要重新开始，不要重写已有 SVG。",
			`当前 svg_output/ 已有 ${svgCount}/${options.slideCount} 页。请从第 ${nextSlide} 页继续逐页生成，直到第 ${options.slideCount} 页全部完成。`,
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，然后立即停止；不要执行 Step 7。",
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
			"每页生成前必须重新读取 spec_lock.md。全部 SVG 完成后生成 notes/total.md，运行质量检查并修复，然后立即停止；不要执行 Step 7。",
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
		"请立刻继续执行 PPT Master 规划与 Executor 流程：写入 design_spec.md 和 spec_lock.md，按需跳过无可用环境的可选图片生成，顺序逐页生成 svg_output/*.svg，生成 notes/total.md，运行质量检查并修复，然后立即停止；不要执行 Step 7。",
		"不要再输出确认问题。不要只输出计划。完成前不要停止。",
	].join("\n");
}

function buildTemplateFillContinuePrompt(
	projectDir: string,
	turn: number,
	previous: CommandResult,
	params: GenerationParams,
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
		params.confirmDesign && !params.planningConfirmed
			? "继续完成 analyze、draft fill_plan 和 check-plan。fill_plan.status 必须保持 draft；检查无 error 后立即停止，不得运行 apply 或写入 exports/。"
			: "继续执行 `workflows/template-fill-pptx.md`：完成 analyze、fill_plan、check-plan、apply 和最终 PPTX 回读验证。",
		params.confirmDesign && !params.planningConfirmed
			? "服务器会在用户确认页面映射后恢复本任务。当前不得自行确认方案。"
			: "方案已经批准，不要再次请求确认。必须在 exports/ 下生成原生可编辑 PPTX 后才能结束。",
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

function appendPptToolCalls(
	target: PptAgentToolCall[],
	calls: PptAgentToolCall[],
) {
	const offset = target.reduce(
		(maximum, call) =>
			Math.max(maximum, call.endEventIndex || call.startEventIndex || 0),
		0,
	);
	for (const call of calls) {
		target.push({
			...call,
			startEventIndex:
				call.startEventIndex === undefined
					? undefined
					: call.startEventIndex + offset,
			endEventIndex:
				call.endEventIndex === undefined
					? undefined
					: call.endEventIndex + offset,
		});
	}
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
		const toolCollector = new PptAgentToolCallCollector();
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
			let terminationError: Error | null = null;
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

			const terminate = (error: Error) => {
				if (settled || terminationError) return;
				terminationError = error;
				clearInterval(timer);
				clearTimeout(timeout);
				options.signal?.removeEventListener("abort", abort);
				terminateProcessTree(proc);
			};
			const timeout = setTimeout(
				() =>
					terminate(
						new Error(
							`PPT Master agent 执行超时（${Math.round(timeoutMs / 60000)} 分钟）。`,
						),
					),
				timeoutMs,
			);
			const abort = () => {
				terminate(
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
		let evidencePending = "";
		let droppingOversizedEvidenceLine = false;
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
		const captureToolEvidence = (chunkText: string) => {
			let text = chunkText;
			if (droppingOversizedEvidenceLine) {
				const newline = text.search(/\r?\n/);
				if (newline < 0) return;
				const newlineLength = text[newline] === "\r" ? 2 : 1;
				text = text.slice(newline + newlineLength);
				droppingOversizedEvidenceLine = false;
			}
			const lines = (evidencePending + text).split(/\r?\n/);
			evidencePending = lines.pop() || "";
			for (const line of lines) {
				if (line.length > MAX_AGENT_EVIDENCE_LINE_CHARS) {
					toolCollector.markIncomplete();
				} else if (line.trim()) {
					toolCollector.consumeJsonLine(line);
				}
			}
			if (evidencePending.length > MAX_AGENT_EVIDENCE_LINE_CHARS) {
				toolCollector.markIncomplete();
				evidencePending = "";
				droppingOversizedEvidenceLine = true;
			}
		};
		const onChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			if (stream === "stdout") captureToolEvidence(text);
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
			if (!droppingOversizedEvidenceLine && evidencePending.trim()) {
				if (evidencePending.length <= MAX_AGENT_EVIDENCE_LINE_CHARS) {
					toolCollector.consumeJsonLine(evidencePending);
				} else {
					toolCollector.markIncomplete();
				}
			}
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
				if (terminationError) {
					reject(terminationError);
					return;
				}
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
				resolvePromise({
					output,
					...metadata,
					toolCalls: toolCollector.getCalls(),
					toolCaptureComplete: toolCollector.isComplete(),
				});
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
				resolvePromise({
					output,
					...metadata,
					toolCalls: toolCollector.getCalls(),
					toolCaptureComplete: toolCollector.isComplete(),
				});
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

function extractResultMetadata(
	output: string,
): Omit<CommandResult, "output" | "toolCalls" | "toolCaptureComplete"> {
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
	if (svgCount >= options.slideCount) {
		try {
			assertPptSpeakerNotesSource(projectDir, options.slideCount);
			return false;
		} catch {
			return true;
		}
	}
	const needsMoreSlides = svgCount < options.slideCount;
	return (
		result.stopReason === "tool_use" ||
		(svgCount > 0 && needsMoreSlides) ||
		(existsSync(join(projectDir, "spec_lock.md")) && needsMoreSlides) ||
		/请确认|确认后|wait for|explicit user confirmation|Eight Confirmations|Strategist confirmation|继续执行/i.test(
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
		return "SVG 已齐，继续生成讲稿并完成静态质量检查";
	if (svgCount > 0)
		return `继续生成剩余 SVG（${svgCount}/${options.slideCount} 已完成）`;
	if (existsSync(join(projectDir, "spec_lock.md")))
		return "规划已完成，继续逐页写入 SVG";
	return "确认门控并推进到规划与生成";
}

function hasPptx(projectDir: string) {
	return Boolean(findLatestPptx(projectDir));
}

function isTemplateFillConfirmationReady(
	params: GenerationParams,
	options: RunnerOptions,
) {
	return (
		options.workflow === "template-fill" &&
		Boolean(params.confirmDesign) &&
		!params.planningConfirmed &&
		[
			join(options.projectDir, "analysis", "slide_library.json"),
			join(options.projectDir, "analysis", "fill_plan.json"),
			join(options.projectDir, "analysis", "check_report.json"),
		].every(existsSync)
	);
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
	const svgFiles = assertExactPptSvgCount(
		options.projectDir,
		options.slideCount,
	);
	assertPptSpeakerNotesSource(options.projectDir, options.slideCount);
	const svgCount = svgFiles.length;

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

	normalizePptSpecLock(options.projectDir);
	const quality = await checkSvgQuality(options.projectDir, skillDir);
	if (quality.errors.length > 0) {
		throw new Error(`SVG 质量检查失败：${quality.errors.join("; ")}`);
	}
}

async function runServerSideExport(
	projectDir: string,
	skillDir: string,
	expectedSlideCount: number,
) {
	assertPptSpeakerNotesSource(projectDir, expectedSlideCount);
	await splitNotes(projectDir, skillDir);
	assertPptSplitSpeakerNotes(projectDir, expectedSlideCount);
	resetOutputDirectory(join(projectDir, "svg_final"));
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

async function validateExportedPptx(
	projectDir: string,
	pptxPath: string,
	expectedSlideCount: number,
	skillDir: string,
	options: { requireSplitNotes?: boolean } = {},
) {
	if (!existsSync(pptxPath) || statSync(pptxPath).size < 4 || !hasZipSignature(pptxPath)) {
		throw new Error("PPTX 导出文件无效或已损坏。");
	}
	if (options.requireSplitNotes !== false) {
		assertPptSplitSpeakerNotes(projectDir, expectedSlideCount);
	}
	const validationDir = join(projectDir, "validation");
	mkdirSync(validationDir, { recursive: true });
	const readbackPath = join(validationDir, "final-readback.md");
	await executePptPython(
		getPptScriptPath(join("source_to_md", "ppt_to_md.py"), skillDir),
		[pptxPath, "-o", readbackPath],
		300_000,
		skillDir,
	);
	assertPptxReadback(readbackPath, expectedSlideCount);
	return readbackPath;
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
	if (!options.nativeTemplatePath) {
		throw new Error("原生模板填充缺少上传模板路径。");
	}
	const templatePath = resolve(
		options.projectDir,
		options.nativeTemplatePath,
	);
	if (!existsSync(templatePath)) {
		throw new Error("原生模板填充的上传模板文件已丢失。");
	}
	const templateFillScript = getPptScriptPath(
		"template_fill_pptx.py",
		skillDir,
	);
	const libraryPath = join(analysisDir, "slide_library.json");
	const planPath = join(analysisDir, "fill_plan.json");
	const reportPath = join(analysisDir, "check_report.json");
	await executePptPython(
		templateFillScript,
		["analyze", templatePath, "-o", libraryPath],
		180_000,
		skillDir,
	);
	await executePptPython(
		templateFillScript,
		["check-plan", libraryPath, planPath, "-o", reportPath],
		180_000,
		skillDir,
	);
	const { slideCount } = assertNativeTemplateFillArtifacts(
		options.projectDir,
		options.slideCount,
	);
	if (hasPptTemplateFillDecision(options.projectDir)) {
		assertPptTemplateFillDecisionApplied(
			options.projectDir,
			options.slideCount,
		);
	}

	await emitProjectLog(
		projectId,
		options.emit,
		"宿主正在按已验证的模板填充方案重新生成最终 PPTX",
		options.workerLease,
	);
	const exportsDir = join(options.projectDir, "exports");
	resetOutputDirectory(exportsDir);
	await executePptPython(
		templateFillScript,
		[
			"apply",
			templatePath,
			planPath,
			"-o",
			join(exportsDir, "generated.pptx"),
			"--transition",
			"keep",
		],
		300_000,
		skillDir,
	);
	const pptxPath = findLatestPptx(options.projectDir);
	if (!pptxPath) {
		throw new Error("原生模板填充没有生成有效 PPTX 文件。");
	}
	assertNativeTemplatePptxPackage(templatePath, pptxPath, slideCount);
	await executePptPython(
		templateFillScript,
		["validate", options.projectDir],
		300_000,
		skillDir,
	);
	const officialValidateReport = readJsonFile(
		join(options.projectDir, "validation", "validate_report.json"),
	);
	const officialErrorCount = Number(
		(officialValidateReport.summary as Record<string, unknown> | undefined)
			?.error || 0,
	);
	if (officialErrorCount > 0) {
		throw new Error(
			`原生模板填充官方回读仍有 ${officialErrorCount} 个错误。`,
		);
	}
	await validateExportedPptx(
		options.projectDir,
		pptxPath,
		slideCount,
		skillDir,
		{ requireSplitNotes: false },
	);

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
