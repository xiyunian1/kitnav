import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
	consumeCreditsInTransaction,
	getSettingNumber,
	InsufficientCreditsError,
} from "@/lib/credits";
import { logger } from "@/lib/logger";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import {
	getPptCreditsPerSlide,
	resolvePptAgentBillingMode,
} from "@/lib/ppt-agent/billing";
import { getPptStyleLabel, getPptStylePreset } from "@/lib/ppt-agent/styles";
import { releaseStaleProject } from "@/lib/ppt-agent/queue";
import { getStaleActiveProjectMs } from "@/lib/ppt-agent/timings";
import { resolveUploadPath } from "@/lib/ppt-agent/upload-paths";
import { PPT_PROCESSING_STATUSES } from "@/lib/ppt-agent/status";
import { tryAcquirePptStorageReferenceLock } from "@/lib/ppt-agent/storage-lock";
import {
	enforceUserRequestLimit,
	REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
	JSON_BODY_LIMITS,
	jsonRequestErrorDetails,
	readLimitedJsonBody,
} from "@/lib/json-request";
import { checkPptQueueCapacity } from "@/lib/queue-capacity";
import { MODEL_SOURCES } from "@/lib/module-model-options";
import {
	ProviderConfigInvalidError,
	ProviderNotConfiguredError,
	resolveImageProvider,
} from "@/lib/providers";
import { assertModuleOperationAllowed, OperationBlockedError } from "@/lib/operations";
import { SETTING_KEYS } from "@/lib/settings-config";
import {
	getPptImageCountLimit,
	getPptImageUnitCreditCost,
} from "@/lib/ppt-agent/image-options";
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

class PptUploadUnavailableError extends Error {
	constructor(
		message: string,
		public readonly status = 400,
	) {
		super(message);
		this.name = "PptUploadUnavailableError";
	}
}

class PptQueueCapacityError extends Error {
	constructor() {
		super("当前 PPT 生成任务较多，请稍后再试。");
		this.name = "PptQueueCapacityError";
	}
}

const requestSchema = z
	.object({
		sourceType: z.enum(["topic", "markdown", "document"]).optional(),
		prompt: z.string().trim().max(80000).optional(),
		sourceFileUrls: z.array(z.string().trim().max(2000)).max(10).optional(),
		templateFileUrls: z.array(z.string().trim().max(2000)).max(1).optional(),
		sourceTopic: z.string().trim().max(4000).optional(),
		sourceMarkdown: z.string().trim().max(80000).optional(),
		sourceFileUrl: z.string().trim().max(2000).optional(),
		slideCount: z.coerce.number().int().min(3).max(30).default(10),
		aspectRatio: z.enum(["16:9", "4:3"]).default("16:9"),
		style: z.string().trim().min(1).max(80).default("auto"),
		customStyle: z.string().trim().max(2000).optional(),
		model: z.string().trim().min(1).max(100),
		modelSource: z.enum(MODEL_SOURCES),
		imageModel: z.string().trim().min(1).max(100).optional(),
		imageModelSource: z.enum(MODEL_SOURCES).optional(),
		visualReview: z.boolean().default(false),
		textVolume: z.enum(PPT_TEXT_VOLUME_VALUES).default("balanced"),
		audience: z.enum(PPT_AUDIENCE_VALUES).default("general"),
		tone: z.enum(PPT_TONE_VALUES).default("natural"),
	})
	.strict()
	.superRefine((data, ctx) => {
		if (Boolean(data.imageModel) !== Boolean(data.imageModelSource)) {
			ctx.addIssue({
				code: "custom",
				path: ["imageModel"],
				message: "图片模型参数不完整，请重新选择。",
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
	const limited = await enforceUserRequestLimit(
		session.user.id,
		REQUEST_LIMITS.pptGenerate,
	);
	if (limited) return limited;

	let parsed: z.infer<typeof requestSchema>;
	try {
		parsed = requestSchema.parse(
			await readLimitedJsonBody(req, JSON_BODY_LIMITS.pptGeneration),
		);
	} catch (error) {
		const bodyError = jsonRequestErrorDetails(error, "请求参数错误");
		const message =
			error instanceof z.ZodError ? error.issues[0]?.message : bodyError.message;
		return Response.json(
			{ error: message || "请求参数错误" },
			{ status: bodyError.status },
		);
	}

	const staleMs = getStaleActiveProjectMs();
	const activeProjects = await prisma.pptProject.findMany({
		where: {
			userId: session.user.id,
			status: { in: [...PPT_PROCESSING_STATUSES] },
		},
		orderBy: { updatedAt: "desc" },
		select: { id: true, updatedAt: true, workerLease: true },
	});

	const now = Date.now();
	const staleBefore = new Date(now - staleMs);
	for (const activeProject of activeProjects) {
		if (now - activeProject.updatedAt.getTime() > staleMs) {
			const released = await releaseStaleProject(activeProject.id, undefined, {
				expectedLease: activeProject.workerLease,
				staleBefore,
			});
			if (released) continue;
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
	if (parsed.visualReview && !billingMode.supportsVision) {
		return Response.json(
			{ error: "所选 PPT 模型未启用视觉能力，无法执行视觉复核。" },
			{ status: 400 },
		);
	}
	const textCreditsCost = billingMode.useOwnKey
		? 0
		: parsed.slideCount * getPptCreditsPerSlide();
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
	let uploadInputs: ReturnType<typeof resolvePptUploadInputs>;
	try {
		uploadInputs = resolvePptUploadInputs(userId, parsed);
	} catch (error) {
		return Response.json(
			{
				error:
					error instanceof Error
						? error.message
						: "上传文件不存在或已过期，请重新上传。",
			},
			{ status: 400 },
		);
	}
	const {
		resolvedFileUrls,
		uploadedTemplateFileUrls,
		resolvedSingleFileUrl,
	} = uploadInputs;
	if (uploadedTemplateFileUrls.some((file) => !isUploadedPptTemplateFile(file))) {
		return Response.json(
			{ error: "模板文件必须是 PPTX、PPTM、PPSX、PPSM、POTX 或 POTM 格式。" },
			{ status: 400 },
		);
	}
	if (uploadedTemplateFileUrls.length > 0 && parsed.visualReview) {
		return Response.json(
			{ error: "原生 PPTX 模板填充暂不支持视觉复核。" },
			{ status: 400 },
		);
	}
	if (
		uploadedTemplateFileUrls.length > 0 &&
		!parsed.prompt &&
		resolvedFileUrls.length === 0 &&
		!parsed.sourceMarkdown &&
		!parsed.sourceTopic
	) {
		return Response.json(
			{ error: "请描述你想生成的 PPT 内容，模板只用于控制版式和视觉风格。" },
			{ status: 400 },
		);
	}

	let imageModel: string | undefined;
	let imageModelSource: (typeof MODEL_SOURCES)[number] | undefined;
	let imageCountLimit: number | undefined;
	let imageUnitCreditCost = 0;
	if (
		uploadedTemplateFileUrls.length === 0 &&
		parsed.imageModel &&
		parsed.imageModelSource
	) {
		try {
			await assertModuleOperationAllowed(session.user.id, "IMAGE");
			const resolvedImage = await resolveImageProvider(
				session.user.id,
				"IMAGE",
				parsed.imageModel,
				parsed.imageModelSource,
			);
			const fallbackCost = await getSettingNumber(
				SETTING_KEYS.IMAGE_CREDIT_COST,
			);
			imageModel = resolvedImage.model;
			imageModelSource = resolvedImage.source;
			imageCountLimit = getPptImageCountLimit(parsed.slideCount);
			imageUnitCreditCost = getPptImageUnitCreditCost({
				source: resolvedImage.source,
				creditCost: resolvedImage.creditCostOverride,
				fallbackCost,
			});
		} catch (error) {
			const message =
				error instanceof OperationBlockedError ||
				error instanceof ProviderConfigInvalidError
					? error.message
					: error instanceof ProviderNotConfiguredError
						? "图片服务尚未配置，请重新选择。"
						: "所选图片模型不可用，请重新选择。";
			return Response.json(
				{ error: message },
				{ status: error instanceof OperationBlockedError ? error.status : 400 },
			);
		}
	}
	const imageCreditsCost = (imageCountLimit || 0) * imageUnitCreditCost;
	const creditsCost = textCreditsCost + imageCreditsCost;
	const useOwnKey = creditsCost === 0;
	const storedParams = JSON.stringify({
		sourceType: normalizedSourceType,
		sourceTopic: parsed.sourceTopic,
		sourceMarkdown: parsed.sourceMarkdown,
		sourceFileUrl: resolvedSingleFileUrl,
		prompt: parsed.prompt,
		sourceFileUrls: resolvedFileUrls,
		templateFileUrls: uploadedTemplateFileUrls,
		slideCount: parsed.slideCount,
		aspectRatio: parsed.aspectRatio,
		style: resolvedStyle.style,
		stylePrompt: resolvedStyle.stylePrompt,
		styleLabel: resolvedStyle.styleLabel,
		model: billingMode.defaultModel,
		modelSource: billingMode.source,
		imageModel,
		imageModelSource,
		imageCountLimit,
		imageUnitCreditCost,
		visualReview: parsed.visualReview,
		textVolume: parsed.textVolume,
		audience: parsed.audience,
		tone: parsed.tone,
	});

	let projectId = "";
	try {
		const project = await prisma.$transaction(async (tx) => {
			const id = crypto.randomUUID();
			if (!(await tryAcquirePptStorageReferenceLock(tx))) {
				throw new PptUploadUnavailableError(
					"文件存储正在清理，请稍后重试。",
					503,
				);
			}
			resolvePptUploadInputs(userId, parsed);
			const capacity = await checkPptQueueCapacity(tx);
			if (!capacity.allowed) throw new PptQueueCapacityError();
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
					`PPT 生成预扣费（${parsed.slideCount} 页${imageCountLimit ? `，最多 ${imageCountLimit} 张配图` : ""}）`,
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
						| "DOCUMENT",
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
				: error instanceof PptUploadUnavailableError
					? error.message
					: error instanceof PptQueueCapacityError
						? error.message
						: error instanceof InsufficientCreditsError
							? `积分不足，需要 ${error.required}，当前 ${error.balance}`
							: "创建生成任务失败";
		if (
			!(error instanceof ActivePptProjectError) &&
			!(error instanceof PptUploadUnavailableError) &&
			!(error instanceof PptQueueCapacityError) &&
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
						: error instanceof PptUploadUnavailableError
							? error.status
							: error instanceof PptQueueCapacityError
								? 503
								: error instanceof InsufficientCreditsError
									? 402
									: 500,
			},
		);
	}

	return Response.json({ projectId, status: "QUEUED" });
}

function resolvePptUploadInputs(
	userId: string,
	input: z.infer<typeof requestSchema>,
) {
	try {
		return {
			resolvedFileUrls: (input.sourceFileUrls ?? []).map((token) =>
				resolveUploadPath(userId, token),
			),
			uploadedTemplateFileUrls: (input.templateFileUrls ?? []).map((token) =>
				resolveUploadPath(userId, token),
			),
			resolvedSingleFileUrl: input.sourceFileUrl
				? resolveUploadPath(userId, input.sourceFileUrl)
				: undefined,
		};
	} catch (error) {
		throw new PptUploadUnavailableError(
			error instanceof Error
				? error.message
				: "上传文件不存在或已过期，请重新上传。",
		);
	}
}

function resolveSourceType(
	input: z.infer<typeof requestSchema>,
): "topic" | "markdown" | "document" {
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
