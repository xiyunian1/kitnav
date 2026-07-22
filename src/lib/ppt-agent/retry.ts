import { prisma } from "@/lib/db";
import {
	consumeCreditsInTransaction,
	getSettingNumber,
	InsufficientCreditsError,
} from "@/lib/credits";
import { onError } from "@/lib/logger";
import type { ModelSource } from "@/lib/module-model-options";
import {
	ProviderConfigInvalidError,
	ProviderNotConfiguredError,
	resolveImageProvider,
} from "@/lib/providers";
import { checkPptQueueCapacity } from "@/lib/queue-capacity";
import { SETTING_KEYS } from "@/lib/settings-config";
import {
	getPptCreditsPerSlide,
	resolvePptAgentBillingMode,
} from "./billing";
import {
	getPptImageCountLimit,
	getPptImageUnitCreditCost,
} from "./image-options";
import { appendProjectLog } from "./project-log";
import { clampSlideCount } from "./project-utils";
import { PPT_PROCESSING_STATUSES } from "./status";
import { tryAcquirePptStorageReferenceLock } from "./storage-lock";

interface RetryableProjectState {
	status: string;
	error?: string | null;
	artifactsDeletedAt?: Date | string | null;
	params?: string | null;
}

interface StoredRetryParams extends Record<string, unknown> {
	model?: string;
	modelSource?: ModelSource;
	imageModel?: string;
	imageModelSource?: ModelSource;
	imageCountLimit?: number;
	imageUnitCreditCost?: number;
	textCreditsCost?: number;
	slideCount?: number;
	visualReview?: boolean;
	retryAttempt?: number;
}

interface RetryProjectSnapshot extends RetryableProjectState {
	id: string;
	params: string | null;
	model: string | null;
	slideCount: number | null;
	creditsCost: number;
}

export class PptRetryError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "PptRetryError";
	}
}

export function canRetryPptProject(project: RetryableProjectState) {
	return (
		project.status === "FAILED" &&
		!project.artifactsDeletedAt &&
		project.params !== null &&
		!isCancelledFailure(project.error)
	);
}

export async function retryPptProject(projectId: string, userId: string) {
	const snapshot = await prisma.pptProject.findFirst({
		where: { id: projectId, userId },
		select: {
			id: true,
			status: true,
			error: true,
			artifactsDeletedAt: true,
			params: true,
			model: true,
			slideCount: true,
			creditsCost: true,
		},
	});
	if (!snapshot) throw new PptRetryError("PPT 项目不存在", 404);
	assertRetryable(snapshot);

	const stored = parseStoredRetryParams(snapshot.params);
	const reservation = await resolveRetryReservation(userId, snapshot, stored);
	const nextParams = JSON.stringify({
		...stored,
		model: reservation.model,
		modelSource: reservation.modelSource,
		textCreditsCost: reservation.textCreditsCost,
		imageUnitCreditCost: reservation.imageUnitCreditCost,
		retryAttempt: normalizeNonNegativeInteger(stored.retryAttempt) + 1,
	});

	const queued = await prisma.$transaction(async (tx) => {
		if (!(await tryAcquirePptStorageReferenceLock(tx))) {
			throw new PptRetryError("文件存储正在清理，请稍后重试。", 503);
		}
		const capacity = await checkPptQueueCapacity(tx);
		const project = await tx.pptProject.findFirst({
			where: { id: projectId, userId },
			select: {
				id: true,
				status: true,
				error: true,
				artifactsDeletedAt: true,
				params: true,
				creditsCost: true,
			},
		});
		if (!project) throw new PptRetryError("PPT 项目不存在", 404);
		assertRetryable(project);
		if (project.params !== snapshot.params) {
			throw new PptRetryError("项目配置已更新，请刷新后重试。", 409);
		}

		if (!capacity.allowed) {
			throw new PptRetryError("当前 PPT 生成任务较多，请稍后再试。", 429);
		}
		await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
		const activeProject = await tx.pptProject.findFirst({
			where: {
				userId,
				id: { not: projectId },
				status: { in: [...PPT_PROCESSING_STATUSES] },
			},
			select: { id: true },
		});
		if (activeProject) {
			throw new PptRetryError(
				"你已有一个 PPT 项目正在生成，请等待完成或先停止当前项目。",
				409,
			);
		}
		if (project.creditsCost > 0) {
			throw new PptRetryError("上次失败任务的积分正在退回，请稍后再试。", 409);
		}

		if (reservation.creditsCost > 0) {
			try {
				await consumeCreditsInTransaction(
					tx,
					userId,
					reservation.creditsCost,
					`PPT 失败项目继续生成预扣费（${projectId}）`,
				);
			} catch (error) {
				if (error instanceof InsufficientCreditsError) {
					throw new PptRetryError(
						`积分不足，需要 ${error.required}，当前 ${error.balance}`,
						400,
					);
				}
				throw error;
			}
		}

		const updated = await tx.pptProject.updateMany({
			where: {
				id: projectId,
				userId,
				status: "FAILED",
				workerLease: null,
				artifactsDeletedAt: null,
				params: snapshot.params,
				creditsCost: 0,
			},
			data: {
				status: "QUEUED",
				workerLease: null,
				queuePosition: null,
				currentPhase: "已请求重试，等待从现有进度继续",
				error: null,
				completedAt: null,
				params: nextParams,
				creditsCost: reservation.creditsCost,
				usedOwnKey: reservation.creditsCost === 0,
			},
		});
		if (updated.count !== 1) {
			throw new PptRetryError("项目状态已更新，请刷新后重试。", 409);
		}
		return {
			status: "QUEUED" as const,
			model: reservation.model,
			modelSource: reservation.modelSource,
			creditsCharged: reservation.creditsCost,
		};
	});

	await appendProjectLog(
		projectId,
		`用户请求继续生成，保持原模型 ${queued.model}，从现有项目文件恢复`,
	).catch(onError("ppt-retry", "写入重试日志失败"));
	return queued;
}

function assertRetryable(project: RetryableProjectState & { params?: string | null }) {
	if (project.status !== "FAILED") {
		throw new PptRetryError(
			PPT_PROCESSING_STATUSES.includes(
				project.status as (typeof PPT_PROCESSING_STATUSES)[number],
			)
				? "项目已经在生成中，请勿重复提交。"
				: "只有生成失败的项目可以继续生成。",
			409,
		);
	}
	if (isCancelledFailure(project.error)) {
		throw new PptRetryError("已主动停止的项目不能直接续跑，请重新创建任务。", 409);
	}
	if (project.artifactsDeletedAt || !project.params) {
		throw new PptRetryError("原项目文件已清理，无法继续生成，请重新创建任务。", 409);
	}
}

async function resolveRetryReservation(
	userId: string,
	project: RetryProjectSnapshot,
	stored: StoredRetryParams,
) {
	const model = readNonEmptyString(stored.model) || project.model?.trim();
	if (!model) {
		throw new PptRetryError("原任务没有可恢复的模型信息，请重新创建任务。", 409);
	}
	const modelSource = readModelSource(stored.modelSource);
	if (!modelSource) {
		throw new PptRetryError(
			"原任务的 PPT 模型来源不完整，无法保证使用同一 API，请重新创建任务。",
			409,
		);
	}

	let textMode: Awaited<ReturnType<typeof resolvePptAgentBillingMode>>;
	try {
		textMode = await resolvePptAgentBillingMode(userId, {
			model,
			source: modelSource,
		});
	} catch (error) {
		throw unavailableModelError("PPT", model, error);
	}
	if (
		textMode.source !== modelSource ||
		textMode.defaultModel !== model
	) {
		throw new PptRetryError(
			`原任务使用的 PPT 模型 ${model} 当前不可用，请恢复该模型配置后重试。`,
			409,
		);
	}
	if (stored.visualReview && !textMode.supportsVision) {
		throw new PptRetryError(
			`原任务使用的 PPT 模型 ${model} 当前未启用视觉能力，无法继续视觉复核。`,
			409,
		);
	}

	const slideCount = clampSlideCount(
		normalizePositiveInteger(stored.slideCount) || project.slideCount || 10,
	);
	const textCreditsCost = textMode.useOwnKey
		? 0
		: slideCount * getPptCreditsPerSlide();
	let imageUnitCreditCost = 0;
	let imageCreditsCost = 0;
	const imageModel = readNonEmptyString(stored.imageModel);
	if (imageModel) {
		const imageModelSource = readModelSource(stored.imageModelSource);
		if (!imageModelSource) {
			throw new PptRetryError(
				"原任务的图片模型来源不完整，无法保证使用同一模型，请重新创建任务。",
				409,
			);
		}
		try {
			const imageProvider = await resolveImageProvider(
				userId,
				"IMAGE",
				imageModel,
				imageModelSource,
			);
			if (
				imageProvider.model !== imageModel ||
				imageProvider.source !== imageModelSource
			) {
				throw new ProviderConfigInvalidError("所选图片模型已变化");
			}
			const fallbackCost = await getSettingNumber(
				SETTING_KEYS.IMAGE_CREDIT_COST,
			);
			imageUnitCreditCost = getPptImageUnitCreditCost({
				source: imageProvider.source,
				creditCost: imageProvider.creditCostOverride,
				fallbackCost,
			});
		} catch (error) {
			throw unavailableModelError("图片", imageModel, error);
		}
		const imageCountLimit = Math.min(
			8,
			Math.max(
				1,
				normalizePositiveInteger(stored.imageCountLimit) ||
					getPptImageCountLimit(slideCount),
			),
		);
		imageCreditsCost = imageCountLimit * imageUnitCreditCost;
	}

	return {
		model,
		modelSource,
		textCreditsCost,
		imageUnitCreditCost,
		creditsCost: textCreditsCost + imageCreditsCost,
	};
}

function parseStoredRetryParams(value: string | null): StoredRetryParams {
	if (!value) throw new PptRetryError("原项目参数已清理，无法继续生成。", 409);
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("invalid params");
		}
		return parsed as StoredRetryParams;
	} catch {
		throw new PptRetryError("原项目参数损坏，无法继续生成。", 409);
	}
}

function unavailableModelError(
	label: "PPT" | "图片",
	model: string,
	error: unknown,
) {
	const detail =
		error instanceof ProviderConfigInvalidError ||
		error instanceof ProviderNotConfiguredError
			? `：${error.message}`
			: "";
	return new PptRetryError(
		`原任务使用的${label}模型 ${model} 当前不可用${detail}。请恢复该模型配置后重试。`,
		409,
	);
}

function isCancelledFailure(error: string | null | undefined) {
	return /用户已停止生成|已主动停止/.test(error || "");
}

function readModelSource(value: unknown): ModelSource | undefined {
	return value === "user" || value === "platform" ? value : undefined;
}

function readNonEmptyString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePositiveInteger(value: unknown) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeNonNegativeInteger(value: unknown) {
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
