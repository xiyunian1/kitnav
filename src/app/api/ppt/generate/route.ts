import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeCreditsInTransaction, InsufficientCreditsError } from "@/lib/credits";
import { logger } from "@/lib/logger";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { resolvePptAgentBillingMode } from "@/lib/ppt-agent/billing";
import { getPptStyleLabel, getPptStylePreset } from "@/lib/ppt-agent/styles";
import { releaseStaleProject } from "@/lib/ppt-agent/queue";
import { wakePptWorker } from "@/lib/ppt-agent/start-worker";
import { getStaleActiveProjectMs } from "@/lib/ppt-agent/timings";
import { resolveUploadPath } from "@/lib/ppt-agent/upload-paths";
import { rateLimitCheck, rateLimitResponse } from "@/lib/rate-limit";
import { PPT_PROCESSING_STATUSES } from "@/lib/ppt-agent/status";
import { MODEL_SOURCES } from "@/lib/module-model-options";
import { ProviderConfigInvalidError } from "@/lib/providers";
import {
	PPT_AUDIENCE_VALUES,
	PPT_TEXT_VOLUME_VALUES,
	PPT_TONE_VALUES,
} from "@/lib/ppt-agent/content-options";

export const runtime = "nodejs";

const UPLOADED_TEMPLATE_EXTENSIONS = new Set([
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
]);

class ActivePptProjectError extends Error {
	constructor() {
		super("你已有一个 PPT 项目正在生成，请等待完成或先停止当前项目。");
		this.name = "ActivePptProjectError";
	}
}

const requestSchema = z
	.object({
		sourceType: z.enum(["topic", "markdown", "document", "url"]).optional(),
		prompt: z.string().trim().max(80000).optional(),
		sourceUrls: z.array(z.string().trim().url().max(1000)).max(10).optional(),
		sourceFileUrls: z.array(z.string().trim().max(2000)).max(10).optional(),
		templateUrls: z.array(z.string().trim().url().max(1000)).max(1).optional(),
		sourceTopic: z.string().trim().max(4000).optional(),
		sourceMarkdown: z.string().trim().max(80000).optional(),
		sourceFileUrl: z.string().trim().max(2000).optional(),
		sourceUrl: z.string().trim().url().max(1000).optional(),
		slideCount: z.coerce.number().int().min(3).max(30).default(10),
		aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
		style: z.string().trim().min(1).max(80).default("auto"),
		customStyle: z.string().trim().max(2000).optional(),
		model: z.string().trim().min(1).max(100),
		modelSource: z.enum(MODEL_SOURCES),
		textVolume: z.enum(PPT_TEXT_VOLUME_VALUES).default("balanced"),
		audience: z.enum(PPT_AUDIENCE_VALUES).default("general"),
		tone: z.enum(PPT_TONE_VALUES).default("natural"),
	})
	.superRefine((data, ctx) => {
		if (
			data.sourceType === "url" ||
			data.sourceUrl ||
			data.sourceUrls?.length ||
			data.templateUrls?.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["sourceUrl"],
				message: "PPT 生成仅支持上传文件资料，不支持链接。",
			});
			return;
		}
		const hasCombinedInput = Boolean(
			data.prompt || data.sourceFileUrls?.length,
		);
		if (hasCombinedInput) return;
		if (!data.sourceType) {
			ctx.addIssue({
				code: "custom",
				path: ["prompt"],
				message: "请描述你想生成的 PPT，或上传文件资料",
			});
			return;
		}
		if (data.sourceType === "topic" && !data.sourceTopic) {
			ctx.addIssue({
				code: "custom",
				path: ["sourceTopic"],
				message: "请输入 PPT 主题",
			});
		}
		if (data.sourceType === "markdown" && !data.sourceMarkdown) {
			ctx.addIssue({
				code: "custom",
				path: ["sourceMarkdown"],
				message: "请粘贴 Markdown 内容",
			});
		}
		if (data.sourceType === "document" && !data.sourceFileUrl) {
			ctx.addIssue({
				code: "custom",
				path: ["sourceFileUrl"],
				message: "请先上传文档",
			});
		}
	});

/**
 * 创建一个 PPT 生成任务并入队。
 *
 * 不再在请求内同步执行生成（原 SSE 流受 maxDuration 约束，无法支撑 CLI 模式长任务）。
 * 本路由仅：校验 → 预扣积分 → 创建项目（QUEUED）→ 持久化完整入参 → 启动后台 worker
 * → 立即返回 projectId。前端轮询 GET /api/ppt/projects/[id] 获取进度。
 */
export async function POST(req: NextRequest) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		await assertControlledModuleAvailableForUser("ppt", session.user.id);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "PPT 模块不可用" },
			{ status: 403 },
		);
	}

	// 限流：防生成接口被滥打（预扣费、入队都是重操作）。
	const genLimit = rateLimitCheck(
		`ppt-generate:u:${session.user.id}`,
		Math.max(1, Number(process.env.PPT_GENERATE_RATE_MAX || 10)),
		Math.max(1000, Number(process.env.PPT_GENERATE_RATE_WINDOW_MS || 60_000)),
	);
	if (!genLimit.allowed)
		return rateLimitResponse(genLimit, "生成请求过于频繁，请稍后再试。");

	let parsed: z.infer<typeof requestSchema>;
	try {
		parsed = requestSchema.parse(await req.json());
	} catch (error) {
		const message =
			error instanceof z.ZodError ? error.issues[0]?.message : "请求参数错误";
		return Response.json({ error: message || "请求参数错误" }, { status: 400 });
	}

	const staleMs = getStaleActiveProjectMs();
	const activeProjects = await prisma.pptProject.findMany({
		where: {
			userId: session.user.id,
			status: { in: [...PPT_PROCESSING_STATUSES] },
		},
		orderBy: { updatedAt: "desc" },
		select: { id: true, updatedAt: true },
	});

	const now = Date.now();
	for (const activeProject of activeProjects) {
		if (now - activeProject.updatedAt.getTime() > staleMs) {
			await releaseStaleProject(activeProject.id);
			continue;
		}
		return Response.json(
			{ error: "你已有一个 PPT 项目正在生成，请等待完成或先停止当前项目。" },
			{ status: 429 },
		);
	}

	let billingMode: Awaited<ReturnType<typeof resolvePptAgentBillingMode>>;
	try {
		billingMode = await resolvePptAgentBillingMode(session.user.id, {
			model: parsed.model,
			source: parsed.modelSource,
		});
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof ProviderConfigInvalidError
						? error.message
						: "所选 PPT 模型不可用，请重新选择。",
			},
			{ status: 400 },
		);
	}
	if (billingMode.source === "none") {
		return Response.json(
			{ error: "暂无可用 PPT 模型，请先在 API 设置中保存模型或联系管理员。" },
			{ status: 503 },
		);
	}
	const useOwnKey = billingMode.useOwnKey;
	const creditsCost = useOwnKey
		? 0
		: parsed.slideCount * Number(process.env.PPT_CREDITS_PER_SLIDE || 10);
	const title = buildTitle(parsed);
	const normalizedSourceType = resolveSourceType(parsed);
	let resolvedStyle: Awaited<ReturnType<typeof resolveStyleInput>>;
	try {
		resolvedStyle = await resolveStyleInput({
			userId: session.user.id,
			style: parsed.style,
			customStyle: parsed.customStyle,
		});
	} catch (error) {
		return Response.json(
			{
				error: error instanceof Error ? error.message : "PPT 风格不可用",
			},
			{ status: 400 },
		);
	}

	// 完整入参（除 signal 外）序列化进 params 列，供后台 worker 异步重建 GenerationParams。
	// 上传文件标识（不透明 token）在此解析为服务器内部路径；绝对路径永不返回客户端。
	const userId = session.user.id;
	const resolvedFileUrls = (parsed.sourceFileUrls ?? []).map((token) =>
		resolveUploadPath(userId, token),
	);
	const uploadedTemplateFileUrls = resolvedFileUrls.filter(
		isUploadedPptTemplateFile,
	);
	const contentFileUrls = resolvedFileUrls.filter(
		(filePath) => !uploadedTemplateFileUrls.includes(filePath),
	);
	if (
		uploadedTemplateFileUrls.length > 0 &&
		!parsed.prompt &&
		contentFileUrls.length === 0 &&
		!parsed.sourceMarkdown &&
		!parsed.sourceTopic
	) {
		return Response.json(
			{ error: "请描述你想生成的 PPT 内容，模板只用于控制版式和视觉风格。" },
			{ status: 400 },
		);
	}
	const resolvedSingleFileUrl = parsed.sourceFileUrl
		? resolveUploadPath(userId, parsed.sourceFileUrl)
		: undefined;
	const storedParams = JSON.stringify({
		sourceType: normalizedSourceType,
		sourceTopic: parsed.sourceTopic,
		sourceMarkdown: parsed.sourceMarkdown,
		sourceFileUrl: resolvedSingleFileUrl,
		prompt: parsed.prompt,
		sourceFileUrls: contentFileUrls,
		templateFileUrls: uploadedTemplateFileUrls,
		slideCount: parsed.slideCount,
		aspectRatio: parsed.aspectRatio,
		style: resolvedStyle.style,
		stylePrompt: resolvedStyle.stylePrompt,
		styleLabel: resolvedStyle.styleLabel,
		model: billingMode.defaultModel,
		modelSource: billingMode.source,
		textVolume: parsed.textVolume,
		audience: parsed.audience,
		tone: parsed.tone,
	});

	let projectId = "";
	try {
		const project = await prisma.$transaction(async (tx) => {
			const id = crypto.randomUUID();
			await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.user.id} FOR UPDATE`;
			const existingActive = await tx.pptProject.findFirst({
				where: {
					userId: session.user.id,
					status: { in: [...PPT_PROCESSING_STATUSES] },
				},
				select: { id: true },
			});
			if (existingActive) throw new ActivePptProjectError();
			if (creditsCost > 0) {
				await consumeCreditsInTransaction(
					tx,
					session.user.id,
					creditsCost,
					`PPT 生成预扣费（${parsed.slideCount} 页）`,
				);
			}
			return tx.pptProject.create({
				data: {
					id,
					userId: session.user.id,
					title,
					sourceType: normalizedSourceType.toUpperCase() as
						| "TOPIC"
						| "MARKDOWN"
						| "DOCUMENT"
						| "URL",
					sourceTopic: parsed.sourceTopic,
					sourceMarkdown: parsed.sourceMarkdown,
					sourceFileUrl: parsed.sourceFileUrl,
					slideCount: parsed.slideCount,
					aspectRatio: parsed.aspectRatio,
					style: resolvedStyle.style,
					model: billingMode.defaultModel,
					params: storedParams,
					projectPath: `projects/${id}`,
					status: "QUEUED",
					currentPhase: "排队中",
					progress: 0,
					creditsCost,
					usedOwnKey: useOwnKey,
				},
				select: { id: true },
			});
		});
		projectId = project.id;
	} catch (error) {
		const message =
			error instanceof ActivePptProjectError
				? error.message
				: error instanceof InsufficientCreditsError
					? `积分不足，需要 ${error.required}，当前 ${error.balance}`
					: "创建生成任务失败";
		if (
			!(error instanceof ActivePptProjectError) &&
			!(error instanceof InsufficientCreditsError)
		) {
			logger.error("ppt-generate", "创建生成任务失败", {
				error,
				userId: session.user.id,
			});
		}
		return Response.json(
			{ error: message },
			{
				status:
					error instanceof ActivePptProjectError
						? 429
						: error instanceof InsufficientCreditsError
							? 402
							: 500,
			},
		);
	}

	// 启动后台 worker（幂等）消费队列；立即返回，前端轮询项目状态。
	wakePptWorker();

	return Response.json({ projectId, status: "QUEUED" });
}

function resolveSourceType(
	input: z.infer<typeof requestSchema>,
): "topic" | "markdown" | "document" | "url" {
	if (input.prompt || input.sourceFileUrls?.length) return "markdown";
	return input.sourceType || "topic";
}

function isUploadedPptTemplateFile(filePath: string) {
	const lower = filePath.toLowerCase();
	return Array.from(UPLOADED_TEMPLATE_EXTENSIONS).some((ext) =>
		lower.endsWith(ext),
	);
}

function buildTitle(input: z.infer<typeof requestSchema>) {
	if (input.prompt) {
		return (
			input.prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "未命名 PPT"
		);
	}
	if (input.sourceFileUrls?.[0])
		return input.sourceFileUrls[0].split(/[\\/]/).pop() || "未命名 PPT";
	const text =
		input.sourceType === "topic"
			? input.sourceTopic
			: input.sourceType === "document"
				? input.sourceFileUrl?.split(/[\\/]/).pop()
				: input.sourceMarkdown;

	return (text || "未命名 PPT").replace(/\s+/g, " ").trim().slice(0, 60);
}

async function resolveStyleInput(input: {
	userId: string;
	style: string;
	customStyle?: string;
}) {
	const customStyle = input.customStyle?.trim();
	if (customStyle) {
		return {
			style: "custom",
			styleLabel: "自定义风格",
			stylePrompt: customStyle,
		};
	}

	const preset = getPptStylePreset(input.style);
	return {
		style: preset.id,
		styleLabel: getPptStyleLabel(preset.id),
		stylePrompt: preset.prompt,
	};
}
