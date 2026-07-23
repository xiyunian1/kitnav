import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pptSemaphore } from "./semaphore";
import { getPptProjectDir, publicProjectUrl } from "./paths";
import { runPptMasterAgent } from "./agent-runner";
import {
	clampSlideCount,
	ensureProjectStructure,
	resolveSourceMarkdown,
} from "./project-utils";
import { buildPptStyleInstruction, getPptStyleLabel } from "./styles";
import {
	isPptGenerationCancelled,
	isPptWorkerShutdown,
	throwIfPptCancelled,
} from "./cancellation";
import { collectPptArtifactPaths } from "./artifacts";
import { preparePptTemplateSelection } from "./templates";
import {
	emitProjectLog,
	isPptLeaseLostError,
	updateProject,
} from "./project-log";
import { assertPptPythonRuntime } from "./python-tools";
import {
	resolvePptGenerationWorkflow,
	stageNativePptTemplate,
	type PptGenerationWorkflow,
} from "./workflow";
import type { ModelSource } from "@/lib/module-model-options";
import type {
	PptAudience,
	PptTextVolume,
	PptTone,
} from "./content-options";
import type {
	PptColorPreference,
	PptTypographyPreference,
} from "./design-options";
import { getPptInternalErrorMessage } from "./status";
import {
	isPptPlanningConfirmationRequiredError,
	getPptPlanningDecisionPath,
	getPptPlanningRecommendationsPath,
	isLegacyPptPlanningConfirmationStage,
	type LegacyPptPlanningConfirmationStage,
} from "./planning-confirmation";
import { getPptTemplateFillDecisionPath } from "./template-fill-confirmation";

export interface GenerationParams {
	projectId: string;
	userId: string;
	workerLease: string;
	sourceType: "topic" | "document" | "markdown";
	sourceTopic?: string;
	sourceFileUrl?: string;
	sourceMarkdown?: string;
	prompt?: string;
	sourceFileUrls?: string[];
	templateFileUrls?: string[];
	template?: string;
	slideCount?: number;
	aspectRatio?: string;
	style?: string;
	stylePrompt?: string;
	styleLabel?: string;
	model?: string;
	modelSource?: ModelSource;
	imageModel?: string;
	imageModelSource?: ModelSource;
	imageCountLimit?: number;
	imageUnitCreditCost?: number;
	textCreditsCost?: number;
	retryAttempt?: number;
	visualReview?: boolean;
	confirmDesign?: boolean;
	planningConfirmed?: boolean;
	// Transitional support for jobs queued by the former staged confirmation flow.
	planningConfirmationStage?: LegacyPptPlanningConfirmationStage;
	textVolume?: PptTextVolume;
	audience?: PptAudience;
	tone?: PptTone;
	colorPreference?: PptColorPreference;
	typographyPreference?: PptTypographyPreference;
	signal?: AbortSignal;
}

export interface GenerationEvent {
	type: "phase" | "progress" | "log" | "preview" | "error" | "complete";
	data: Record<string, unknown>;
}

export type EventEmitter = (event: GenerationEvent) => void;

export async function generatePPT(
	params: GenerationParams,
	emit: EventEmitter,
): Promise<void> {
	const requestedSlideCount = clampSlideCount(params.slideCount ?? 10);
	const aspectRatio = params.aspectRatio === "4:3" ? "4:3" : "16:9";
	const canvasFormat = aspectRatio === "4:3" ? "ppt43" : "ppt169";
	const projectDir = getPptProjectDir(params.projectId);

	await pptSemaphore.acquire();

	try {
		throwIfPptCancelled(params.signal);
		await assertPptPythonRuntime();
		await emitProjectLog(
			params.projectId,
			emit,
			"初始化 PPT Master 项目目录",
			params.workerLease,
		);
		emit({ type: "phase", data: { phase: "PENDING", progress: 0 } });
		await updateProject(
			params.projectId,
			{
				status: "PENDING",
				currentPhase: "初始化项目",
				progress: 0,
			},
			params.workerLease,
		);

		ensureProjectStructure(projectDir, params.projectId, canvasFormat);
		throwIfPptCancelled(params.signal);

		const workflow = resolvePptGenerationWorkflow(params);
		const preparedSource = await preparePptRunSource(
			params,
			projectDir,
			workflow,
		);
		const sourceMd = preparedSource.sourceMd;
		if (preparedSource.resumed) {
			await emitProjectLog(
				params.projectId,
				emit,
				"已读取原任务资料和规划结果，继续后续生成",
				params.workerLease,
			);
		}
		const templateInstruction = preparePptTemplateSelection(
			params.template,
			projectDir,
		);
		let nativeTemplatePath = "";
		if (workflow === "template-fill") {
			await emitProjectLog(
				params.projectId,
				emit,
				"正在准备原生 PPTX 模板",
				params.workerLease,
			);
			const stagedTemplate = stageNativePptTemplate(
				projectDir,
				params.templateFileUrls || [],
			);
			nativeTemplatePath = stagedTemplate.relativePath;
			await emitProjectLog(
				params.projectId,
				emit,
				"模板将通过原生 PPTX 填充流程处理，不转换为 SVG",
				params.workerLease,
			);
		}
		const runnerOptions: {
			projectDir: string;
			sourceMd: string;
			slideCount: number;
			aspectRatio: "16:9" | "4:3";
			canvasFormat: "ppt169" | "ppt43";
			style: string;
			stylePrompt: string;
			styleLabel: string;
			workflow: PptGenerationWorkflow;
			workerLease: string;
			nativeTemplatePath?: string;
			signal?: AbortSignal;
			visualReview: boolean;
			emit: EventEmitter;
		} = {
			projectDir,
			sourceMd,
			slideCount: requestedSlideCount,
			aspectRatio,
			canvasFormat,
			style: params.style || "auto",
			stylePrompt:
				workflow === "template-fill"
					? "视觉样式完全继承上传的原生 PPTX 模板，不应用站内风格预设覆盖模板。"
					: [
							templateInstruction,
							buildPptStyleInstruction({
								style: params.style,
								stylePrompt: params.stylePrompt,
								styleLabel: params.styleLabel,
								projectId: params.projectId,
								sourceText: sourceMd,
								hasTemplate: Boolean(
									templateInstruction,
								),
							}),
						]
							.filter(Boolean)
							.join("\n\n"),
			styleLabel:
				workflow === "template-fill"
					? "上传模板原生样式"
					: getPptStyleLabel(params.style, params.styleLabel),
			workflow,
			workerLease: params.workerLease,
			nativeTemplatePath: nativeTemplatePath || undefined,
			signal: params.signal,
			visualReview: Boolean(params.visualReview && workflow === "svg"),
			emit,
		};
		throwIfPptCancelled(params.signal);
		await emitProjectLog(
			params.projectId,
			emit,
			workflow === "template-fill"
				? "交给 PPT Master pi agent 执行原生模板填充工作流"
				: "交给 PPT Master pi agent 执行完整工作流",
			params.workerLease,
		);
		const agentParams = preparedSource.resumePlanning
			? {
					...params,
					planningConfirmed: true,
				}
			: params;
		const result = await runPptMasterAgent(agentParams, runnerOptions);
		const pptxUrl = publicProjectUrl(params.projectId, result.pptxPath);

		await updateProject(
			params.projectId,
			{
				status: "COMPLETED",
				workerLease: null,
				currentPhase: "生成完成",
				...collectPptArtifactPaths(projectDir, result.pptxPath),
				slideCount: result.slideCount,
				progress: 100,
				completedAt: new Date(),
			},
			params.workerLease,
		);

		emit({ type: "complete", data: { projectId: params.projectId, pptxUrl } });
	} catch (error) {
		if (isPptWorkerShutdown(error) || isPptLeaseLostError(error)) throw error;
		if (isPptPlanningConfirmationRequiredError(error)) {
			const waitingForTemplate = error.kind === "template-fill";
			const confirmationLabel = waitingForTemplate
				? "模板填充方案"
				: "设计方案";
			await emitProjectLog(
				params.projectId,
				emit,
				`${confirmationLabel}候选已生成，等待用户确认后继续`,
				params.workerLease,
			);
			const confirmationWaitStartedAt = new Date();
			await updateProject(
				params.projectId,
				{
					status: "AWAITING_CONFIRMATION",
					workerLease: null,
					currentPhase: `等待确认${confirmationLabel}`,
					progress: 30,
					error: null,
					confirmationWaitStartedAt,
				},
				params.workerLease,
			);
			throw error;
		}
		const cancelled = isPptGenerationCancelled(error);
		const message = cancelled
			? "用户已停止生成"
			: getPptInternalErrorMessage(error);
		await updateProject(
			params.projectId,
			{
				status: "FAILED",
				currentPhase: cancelled ? "已停止生成" : "生成失败",
				error: message,
			},
			params.workerLease,
		);
		throw error;
	} finally {
		pptSemaphore.release();
	}
}

export async function preparePptRunSource(
	params: GenerationParams,
	projectDir: string,
	workflow: PptGenerationWorkflow = resolvePptGenerationWorkflow(params),
) {
	const sourcePath = join(projectDir, "sources", "source.md");
	const explicitResume = Boolean(
		params.planningConfirmed ||
			isLegacyPptPlanningConfirmationStage(params.planningConfirmationStage),
	);
	const automaticResumeArtifacts = [
		sourcePath,
		getPptPlanningRecommendationsPath(projectDir),
		getPptPlanningDecisionPath(projectDir),
	];
	const resumeAutomaticPlanning =
		workflow === "svg" &&
		!explicitResume &&
		automaticResumeArtifacts.every(existsSync);
	if (explicitResume || resumeAutomaticPlanning) {
		const requiredResumeArtifacts =
			workflow === "template-fill"
				? [
						sourcePath,
						join(projectDir, "analysis", "slide_library.json"),
						join(projectDir, "analysis", "fill_plan.json"),
						getPptTemplateFillDecisionPath(projectDir),
					]
				: [
						sourcePath,
						getPptPlanningRecommendationsPath(projectDir),
						...(params.planningConfirmed || resumeAutomaticPlanning
							? [getPptPlanningDecisionPath(projectDir)]
							: []),
					];
		if (requiredResumeArtifacts.some((path) => !existsSync(path))) {
			throw new Error("PPT 设计确认资料不完整，无法继续原任务。");
		}
		return {
			sourceMd: readFileSync(sourcePath, "utf-8"),
			resumed: true,
			...(resumeAutomaticPlanning ? { resumePlanning: true } : {}),
		};
	}

	const sourceMd = await resolveSourceMarkdown(params, projectDir);
	writeFileSync(sourcePath, sourceMd, "utf-8");
	return { sourceMd, resumed: false };
}
