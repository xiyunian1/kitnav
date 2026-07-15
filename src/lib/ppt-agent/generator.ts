import { writeFileSync } from "fs";
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
	visualReview?: boolean;
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

		const sourceMd = await resolveSourceMarkdown(params, projectDir);
		writeFileSync(join(projectDir, "sources", "source.md"), sourceMd, "utf-8");
		const workflow = resolvePptGenerationWorkflow(params);
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
		const result = await runPptMasterAgent(params, runnerOptions);
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
