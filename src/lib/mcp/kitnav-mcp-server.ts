import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getModuleModelOptions } from "@/lib/providers";
import { getPptCreditsPerSlide } from "@/lib/ppt-agent/billing";
import { createPptGeneration } from "@/lib/ppt-agent/generation-request";
import {
	getPptPlanningConfirmation,
	submitPptPlanningConfirmation,
} from "@/lib/ppt-agent/planning-confirmation-request";
import { createPptDownloadUrl } from "@/lib/ppt-agent/pptx-download";
import { arePptArtifactsExpired, hasPptxArtifact } from "@/lib/ppt-agent/project-public";
import {
	getPptUserFailureMessage,
	isPptCompletedStatus,
	PPT_STATUS_LABELS,
} from "@/lib/ppt-agent/status";
import { PPT_STYLE_PRESETS } from "@/lib/ppt-agent/styles";
import {
	PPT_AUDIENCE_VALUES,
	PPT_TEXT_VOLUME_VALUES,
	PPT_TONE_VALUES,
} from "@/lib/ppt-agent/content-options";
import type { PptPlanningRecommendations } from "@/lib/ppt-agent/planning-confirmation";
import { MODEL_SOURCES } from "@/lib/module-model-options";

export interface KitnavMcpContext {
	userId: string;
	/** 生成下载链接用的站点地址，例如 https://ai.kitnav.com */
	origin: string;
}

/** 工具执行失败时抛出，消息会原样返回给 MCP 客户端。 */
export class McpToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpToolError";
	}
}

const SERVER_INSTRUCTIONS = `KitNav 是 AI PPT 生成服务，生成结果是可编辑的 PPTX。
推荐流程：
1. 需要指定模型时先调用 list_ppt_models；不指定则使用账户的默认模型。
2. 调用 create_ppt 提交主题或 Markdown 正文，得到 project_id。生成通常需要 5–20 分钟，使用平台模型会按页数扣除积分。
3. 每 30–60 秒调用一次 get_ppt_status 查询进度。若状态为 AWAITING_CONFIRMATION，把返回的设计方案选项展示给用户，按用户的选择调用 confirm_ppt_plan。
4. 状态为 COMPLETED 后调用 get_ppt_download 获取 1 小时内有效的下载链接。`;

/** 把共用业务函数返回的 Response 转成工具结果；非 2xx 时抛出带服务端提示的错误。 */
export async function readApiResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		// 非 JSON 响应按状态码处理
	}
	if (!response.ok) {
		const message =
			body && typeof body === "object" && "error" in body && typeof body.error === "string"
				? body.error
				: `请求失败（HTTP ${response.status}）`;
		throw new McpToolError(message);
	}
	return body as T;
}

// ------------------------------------------------------------------ 工具实现

export async function listPptModels(userId: string) {
	const options = await getModuleModelOptions(userId, "PPT");
	return {
		models: options.map((option, index) => ({
			model: option.model,
			source: option.source,
			source_label: option.sourceLabel,
			// 与生成接口的计费一致：平台模型按页数 × PPT_CREDITS_PER_SLIDE 扣积分，自带 API 不扣积分
			credit_cost_per_slide: option.source === "platform" ? getPptCreditsPerSlide() : 0,
			supports_visual_review: option.supportsVision,
			is_default: index === 0,
		})),
		styles: PPT_STYLE_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, description: preset.description })),
	};
}

export const createPptInputShape = {
	topic: z.string().trim().min(1).max(4000).optional().describe("PPT 主题或需求描述，与 content 二选一"),
	content: z.string().trim().min(1).max(80000).optional().describe("用于生成 PPT 的 Markdown 正文，与 topic 二选一"),
	slide_count: z.number().int().min(3).max(30).default(10).describe("页数，3–30"),
	aspect_ratio: z.enum(["16:9", "4:3"]).default("16:9"),
	style: z
		.enum(PPT_STYLE_PRESETS.map((preset) => preset.id) as [string, ...string[]])
		.default("auto")
		.describe("风格 ID，可通过 list_ppt_models 查看说明；auto 为按内容自动选择"),
	model: z.string().trim().min(1).max(100).optional().describe("模型名，来自 list_ppt_models；不填使用默认模型"),
	model_source: z.enum(MODEL_SOURCES).optional().describe("user=用户自己的 API，platform=平台模型"),
	audience: z.enum(PPT_AUDIENCE_VALUES).optional(),
	tone: z.enum(PPT_TONE_VALUES).optional(),
	text_volume: z.enum(PPT_TEXT_VOLUME_VALUES).optional(),
	confirm_design: z
		.boolean()
		.default(false)
		.describe("true 时生成设计方案后暂停，等待 confirm_ppt_plan；false 时自动采用推荐方案"),
	visual_review: z.boolean().default(false).describe("是否在导出前让视觉模型逐页复核（需要模型支持图片输入）"),
};

export const createPptInputSchema = z.object(createPptInputShape);
export type CreatePptInput = z.infer<typeof createPptInputSchema>;

/** 把 MCP 入参转换为网页端生成接口的请求体；模型未指定时取用户可用模型列表的第一项。 */
export function buildPptGenerationBody(
	input: CreatePptInput,
	models: { model: string; source: (typeof MODEL_SOURCES)[number] }[],
) {
	if (Boolean(input.topic) === Boolean(input.content)) {
		throw new McpToolError("请提供 topic 或 content 中的一个");
	}
	const selected = input.model
		? models.find((option) => option.model === input.model && (!input.model_source || option.source === input.model_source))
		: models[0];
	if (!selected) {
		throw new McpToolError(
			models.length
				? `模型 ${input.model} 不可用，可用模型：${models.map((m) => `${m.model}（${m.source}）`).join("、")}`
				: "当前账户没有可用的 PPT 模型，请在网页「API 设置」中配置，或联系管理员开启平台模型",
		);
	}
	return {
		sourceType: input.content ? "markdown" : "topic",
		...(input.content ? { sourceMarkdown: input.content } : { sourceTopic: input.topic }),
		slideCount: input.slide_count,
		aspectRatio: input.aspect_ratio,
		style: input.style,
		model: selected.model,
		modelSource: selected.source,
		confirmDesign: input.confirm_design,
		visualReview: input.visual_review,
		...(input.audience ? { audience: input.audience } : {}),
		...(input.tone ? { tone: input.tone } : {}),
		...(input.text_volume ? { textVolume: input.text_volume } : {}),
	};
}

export async function createPpt(userId: string, input: CreatePptInput) {
	const options = await getModuleModelOptions(userId, "PPT");
	const body = buildPptGenerationBody(input, options);
	const result = await readApiResponse<{ projectId: string; status: string }>(
		await createPptGeneration(userId, async () => body),
	);
	return {
		project_id: result.projectId,
		status: result.status,
		model: body.model,
		next_step: "每 30–60 秒调用 get_ppt_status 查询进度，生成通常需要 5–20 分钟",
	};
}

function summarizePlan(recommendations: PptPlanningRecommendations) {
	const pick = (options: { id: string; label: string; rationale: string }[]) =>
		options.map((option) => ({ id: option.id, label: option.label, rationale: option.rationale }));
	return {
		summary: recommendations.summary,
		directions: pick(recommendations.directions),
		palettes: pick(recommendations.palettes),
		typography: pick(recommendations.typography),
		image_strategies: pick(recommendations.imageStrategies),
		recommended: {
			direction_id: recommendations.recommendedDirectionId,
			palette_id: recommendations.recommendedPaletteId,
			typography_id: recommendations.recommendedTypographyId,
			image_strategy_id: recommendations.recommendedImageStrategyId,
		},
		pages: recommendations.pagePlan.map((page) => ({ page: page.page, title: page.title, purpose: page.purpose })),
	};
}

export async function getPptStatus(userId: string, projectId: string) {
	const project = await prisma.pptProject.findFirst({
		where: { id: projectId, userId },
		select: {
			id: true,
			title: true,
			status: true,
			progress: true,
			currentPhase: true,
			error: true,
			pptxPath: true,
			slideCount: true,
			creditsCost: true,
			createdAt: true,
			completedAt: true,
			updatedAt: true,
			artifactsDeletedAt: true,
			activeGenerationSeconds: true,
		},
	});
	if (!project) throw new McpToolError("PPT 项目不存在");
	const completed = isPptCompletedStatus(project.status);
	const result: Record<string, unknown> = {
		project_id: project.id,
		title: project.title,
		status: project.status,
		status_label: PPT_STATUS_LABELS[project.status] ?? project.status,
		progress: project.progress,
		phase: project.currentPhase,
		slide_count: project.slideCount,
		credits_cost: project.creditsCost,
		created_at: project.createdAt.toISOString(),
		completed_at: project.completedAt?.toISOString() ?? null,
		generation_seconds: project.activeGenerationSeconds,
	};
	if (project.status === "FAILED") {
		result.error = getPptUserFailureMessage(project.error);
	}
	if (completed) {
		result.has_pptx = hasPptxArtifact(project);
		result.artifacts_expired = arePptArtifactsExpired(project);
		result.next_step = result.artifacts_expired ? "文件已超过保留期限，请重新生成" : "调用 get_ppt_download 获取下载链接";
	}
	if (project.status === "AWAITING_CONFIRMATION") {
		const plan = await readApiResponse<{ kind: string; recommendations?: PptPlanningRecommendations }>(
			await getPptPlanningConfirmation(userId, project.id),
		);
		if (plan.kind === "design" && plan.recommendations) {
			result.plan = summarizePlan(plan.recommendations);
			result.next_step = "把方案选项展示给用户，按用户选择调用 confirm_ppt_plan；不传选项则采用推荐方案";
		} else {
			result.next_step = "该项目需要确认模板页面方案，请在网页端完成确认";
		}
	}
	return result;
}

export const confirmPptPlanInputShape = {
	project_id: z.string().trim().min(1).max(64),
	direction_id: z.string().trim().max(80).optional().describe("叙事方向 ID，不填采用推荐值"),
	palette_id: z.string().trim().max(80).optional().describe("配色 ID，不填采用推荐值"),
	typography_id: z.string().trim().max(80).optional().describe("字体方案 ID，不填采用推荐值"),
	image_strategy_id: z.string().trim().max(80).optional().describe("图片策略 ID，不填采用推荐值"),
};

export const confirmPptPlanInputSchema = z.object(confirmPptPlanInputShape);
export type ConfirmPptPlanInput = z.infer<typeof confirmPptPlanInputSchema>;

/** 以推荐方案为默认值组装确认请求，与网页端「采用推荐方案」提交的内容一致。 */
export function buildDesignConfirmation(recommendations: PptPlanningRecommendations, input: ConfirmPptPlanInput) {
	return {
		kind: "design" as const,
		directionId: input.direction_id || recommendations.recommendedDirectionId,
		paletteId: input.palette_id || recommendations.recommendedPaletteId,
		typographyId: input.typography_id || recommendations.recommendedTypographyId,
		imageStrategyId: input.image_strategy_id || recommendations.recommendedImageStrategyId,
		pagePlan: recommendations.pagePlan,
	};
}

export async function confirmPptPlan(userId: string, input: ConfirmPptPlanInput) {
	const plan = await readApiResponse<{ kind: string; status: string; recommendations?: PptPlanningRecommendations }>(
		await getPptPlanningConfirmation(userId, input.project_id),
	);
	if (plan.kind !== "design" || !plan.recommendations) {
		throw new McpToolError("该项目需要确认模板页面方案，请在网页端完成确认");
	}
	const submission = buildDesignConfirmation(plan.recommendations, input);
	const result = await readApiResponse<{ status: string }>(
		await submitPptPlanningConfirmation(userId, input.project_id, async () => submission),
	);
	return {
		project_id: input.project_id,
		status: result.status,
		chosen: {
			direction_id: submission.directionId,
			palette_id: submission.paletteId,
			typography_id: submission.typographyId,
			image_strategy_id: submission.imageStrategyId,
		},
		next_step: "继续调用 get_ppt_status 查询进度",
	};
}

export async function getPptDownload(ctx: KitnavMcpContext, projectId: string) {
	const project = await prisma.pptProject.findFirst({
		where: { id: projectId, userId: ctx.userId },
		select: { id: true, title: true, status: true, pptxPath: true, completedAt: true, updatedAt: true, artifactsDeletedAt: true },
	});
	if (!project) throw new McpToolError("PPT 项目不存在");
	if (!isPptCompletedStatus(project.status) || !project.pptxPath) {
		throw new McpToolError(`项目尚未完成（当前状态：${PPT_STATUS_LABELS[project.status] ?? project.status}）`);
	}
	if (arePptArtifactsExpired(project)) {
		throw new McpToolError("该项目的生成文件已超过保留期限，请重新生成");
	}
	const link = createPptDownloadUrl({ origin: ctx.origin, projectId: project.id, ownerId: ctx.userId });
	return { project_id: project.id, title: project.title, download_url: link.url, expires_at: link.expiresAt.toISOString() };
}

export async function listMyPpts(userId: string, limit: number) {
	const projects = await prisma.pptProject.findMany({
		where: { userId },
		orderBy: { createdAt: "desc" },
		take: limit,
		select: { id: true, title: true, status: true, progress: true, createdAt: true, completedAt: true },
	});
	return {
		projects: projects.map((project) => ({
			project_id: project.id,
			title: project.title,
			status: project.status,
			status_label: PPT_STATUS_LABELS[project.status] ?? project.status,
			progress: project.progress,
			created_at: project.createdAt.toISOString(),
			completed_at: project.completedAt?.toISOString() ?? null,
		})),
	};
}

// ------------------------------------------------------------------ 注册

type ToolResult = {
	content: { type: "text"; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

async function toToolResult(run: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
	try {
		const result = await run();
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
	} catch (error) {
		const message = error instanceof McpToolError ? error.message : "服务暂时不可用，请稍后再试";
		return { content: [{ type: "text", text: message }], isError: true };
	}
}

/** 为一次请求创建 MCP Server，所有工具都以 ctx.userId 的身份执行。 */
export function createKitnavMcpServer(ctx: KitnavMcpContext) {
	const server = new McpServer({ name: "kitnav", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });

	server.registerTool(
		"list_ppt_models",
		{
			title: "查看可用模型和风格",
			description: "列出当前账户可用于生成 PPT 的模型（含每页积分）和可选风格。",
			annotations: { readOnlyHint: true },
		},
		async () => toToolResult(() => listPptModels(ctx.userId)),
	);

	server.registerTool(
		"create_ppt",
		{
			title: "创建 PPT",
			description: "根据主题或 Markdown 正文创建一个 PPT 生成任务，立即返回 project_id，生成在后台进行。",
			inputSchema: createPptInputShape,
		},
		async (input) => toToolResult(() => createPpt(ctx.userId, input)),
	);

	server.registerTool(
		"get_ppt_status",
		{
			title: "查询 PPT 进度",
			description: "查询生成进度。等待确认时返回可选的设计方案，完成后提示获取下载链接。",
			inputSchema: { project_id: z.string().trim().min(1).max(64) },
			annotations: { readOnlyHint: true },
		},
		async ({ project_id }) => toToolResult(() => getPptStatus(ctx.userId, project_id)),
	);

	server.registerTool(
		"confirm_ppt_plan",
		{
			title: "确认设计方案",
			description: "项目处于 AWAITING_CONFIRMATION 时提交设计方案选择；未指定的项采用推荐值。确认后项目继续生成。",
			inputSchema: confirmPptPlanInputShape,
		},
		async (input) => toToolResult(() => confirmPptPlan(ctx.userId, input)),
	);

	server.registerTool(
		"get_ppt_download",
		{
			title: "获取下载链接",
			description: "为已完成的项目生成 PPTX 下载链接，1 小时内有效，无需登录即可下载。",
			inputSchema: { project_id: z.string().trim().min(1).max(64) },
			annotations: { readOnlyHint: true },
		},
		async ({ project_id }) => toToolResult(() => getPptDownload(ctx, project_id)),
	);

	server.registerTool(
		"list_my_ppts",
		{
			title: "我的 PPT",
			description: "按创建时间倒序列出最近的 PPT 项目。",
			inputSchema: { limit: z.number().int().min(1).max(50).default(10) },
			annotations: { readOnlyHint: true },
		},
		async ({ limit }) => toToolResult(() => listMyPpts(ctx.userId, limit)),
	);

	return server;
}
