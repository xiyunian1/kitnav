import { randomUUID } from "node:crypto";
import type { GenerationStatus, ImageTurn, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  consumeCreditsInTransaction,
  getSettingNumber,
  InsufficientCreditsError,
} from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import {
  resolveImageProvider,
  ProviderConfigInvalidError,
  ProviderNotConfiguredError,
} from "@/lib/providers";
import {
  assertModuleOperationAllowed,
  OperationBlockedError,
} from "@/lib/operations";
import {
  IMAGE_QUALITIES,
  IMAGE_QUALITY_META,
  type ImageQuality,
} from "@/lib/image-quality";
import {
  ASPECT_RATIOS,
  RATIO_TO_PIXEL,
  UpstreamImageError,
  type AspectRatio,
} from "@/lib/providers/types";
import {
  normalizeStoredMaterialUrl,
  saveImageFromUrl,
} from "@/lib/materials";
import {
  getImageUpstreamMaxAttempts,
  getImageUserMaxPending,
  getImageWorkerMaxAttempts,
  IMAGE_WORKER_STALE_TIMEOUT_MS,
} from "@/lib/image-worker-config";
import type { ModelSource } from "@/lib/module-model-options";
import {
  deleteImageEditInput,
  readImageEditInput,
  saveImageEditInput,
} from "@/lib/image-inputs";
import { logger } from "@/lib/logger";
import { checkImageQueueCapacity } from "@/lib/queue-capacity";

export interface TurnImage {
  id: string;
  status: "queued" | "loading" | "success" | "error";
  url?: string;
  error?: string;
  upstreamStatus?: number;
  durationMs?: number;
  quality?: string;
}

export interface SerializedTurn {
  id: string;
  conversationId: string;
  prompt: string;
  mode: string;
  model: string;
  providerSource: ModelSource | null;
  ratio: string;
  count: number;
  status: string;
  images: TurnImage[];
  referenceThumbs: string[];
  error: string | null;
  creditsCost: number;
  usedOwnKey: boolean;
  durationMs: number | null;
  generationId: string | null;
  createdAt: string;
}

export type ImageTurnProgressEvent =
  | { type: "created"; turn: SerializedTurn; conversationId: string }
  | { type: "image"; turnId: string; image: TurnImage }
  | { type: "final"; turn: SerializedTurn; conversationId: string };

export interface EnqueueImageTurnOptions {
  userId: string;
  conversationId?: string;
  prompt: string;
  ratio: AspectRatio;
  quality: ImageQuality;
  count: number;
  model?: string;
  modelSource?: ModelSource;
  mode: "generate" | "edit";
  editImage?: { blob: Blob; filename: string };
  referenceThumbs?: string[];
}

export interface ClaimedImageTurn {
  id: string;
  lease: string;
}

export class TurnError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "TurnError";
  }
}

export class ImageWorkerShutdownError extends Error {
  constructor() {
    super("图片 Worker 正在停止");
    this.name = "ImageWorkerShutdownError";
  }
}

class ImageLeaseLostError extends Error {
  constructor() {
    super("图片任务租约已失效");
    this.name = "ImageLeaseLostError";
  }
}

class ImageWorkerRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageWorkerRetryError";
  }
}

const IMAGE_STREAM_POLL_MS = 750;
const IMAGE_HEARTBEAT_MS = 5_000;

function safeParseArray<T>(value: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampImageParallelLimit(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.floor(value)));
}

function imageRequestTimeoutMs(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return 180_000;
  if (seconds === 0) return 0;
  return Math.floor(seconds) * 1000;
}

function getErrorMessage(error: unknown, fallback = "生成失败") {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getUpstreamStatus(error: unknown) {
  return error instanceof UpstreamImageError ? error.status ?? null : null;
}

function firstUpstreamStatus(results: TurnImage[]) {
  return results.find((result) => result.upstreamStatus)?.upstreamStatus ?? null;
}

function summarizeTurnError(
  results: TurnImage[],
  failedCount: number,
  successCount: number,
) {
  if (failedCount === 0) return null;
  const firstError = results.find(
    (result) => result.status === "error" && result.error,
  )?.error;
  if (successCount === 0) return firstError || "全部生成失败";
  return firstError
    ? `其中 ${failedCount} 张未成功：${firstError}`
    : `其中 ${failedCount} 张未成功`;
}

function asQuality(value: string): ImageQuality {
  return IMAGE_QUALITIES.includes(value as ImageQuality)
    ? (value as ImageQuality)
    : "standard";
}

function asRatio(value: string): AspectRatio {
  return ASPECT_RATIOS.includes(value as AspectRatio)
    ? (value as AspectRatio)
    : "1:1";
}

function normalizeTurnImages(turn: Pick<ImageTurn, "images" | "count" | "quality">) {
  const parsed = safeParseArray<TurnImage>(turn.images);
  const qualityLabel = IMAGE_QUALITY_META[asQuality(turn.quality)].label;
  return Array.from({ length: turn.count }, (_, index) => {
    const image = parsed.find((item) => item.id === String(index));
    if (image?.status === "success" && image.url) return image;
    return { id: String(index), status: "queued" as const, quality: qualityLabel };
  });
}

function failedImages(
  turn: Pick<ImageTurn, "images" | "count" | "quality">,
  error: string,
) {
  return normalizeTurnImages(turn).map((image) =>
    image.status === "success"
      ? image
      : { ...image, status: "error" as const, error },
  );
}

function isShutdownSignal(signal: AbortSignal) {
  return signal.aborted && signal.reason instanceof ImageWorkerShutdownError;
}

function throwControlAbort(signal: AbortSignal) {
  if (!signal.aborted) return;
  if (
    signal.reason instanceof ImageWorkerShutdownError ||
    signal.reason instanceof ImageLeaseLostError ||
    signal.reason instanceof ImageWorkerRetryError
  ) {
    throw signal.reason;
  }
}

async function persistGeneratedImageUrl(
  url: string,
  userId: string,
  turnId: string,
  index: number,
) {
  const stored = await saveImageFromUrl(
    url,
    userId,
    { namePrefix: `${turnId}-${index}` },
  );
  return stored.url;
}

export function serializeTurn(turn: ImageTurn): SerializedTurn {
  const images = safeParseArray<TurnImage>(turn.images).map((image) => ({
    ...image,
    ...(image.url
      ? { url: normalizeStoredMaterialUrl(image.url) ?? image.url }
      : {}),
  }));
  return {
    id: turn.id,
    conversationId: turn.conversationId,
    prompt: turn.prompt,
    mode: turn.mode,
    model: turn.model,
    providerSource:
      turn.providerSource === "user" || turn.providerSource === "platform"
        ? turn.providerSource
        : null,
    ratio: turn.ratio,
    count: turn.count,
    status: turn.status,
    images,
    referenceThumbs: safeParseArray<string>(turn.referenceThumbs),
    error: turn.error,
    creditsCost: turn.creditsCost,
    usedOwnKey: turn.usedOwnKey,
    durationMs: turn.durationMs,
    generationId: turn.generationId,
    createdAt: turn.createdAt.toISOString(),
  };
}

async function assertImageOperationAllowed(userId: string) {
  try {
    await assertModuleOperationAllowed(userId, "IMAGE");
  } catch (error) {
    if (error instanceof OperationBlockedError) {
      throw new TurnError(error.status, error.message);
    }
    throw error;
  }
}

async function ensureConversation(
  userId: string,
  conversationId: string | undefined,
  prompt: string,
) {
  if (conversationId) {
    const conversation = await prisma.imageConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new TurnError(404, "会话不存在");
    }
    return { id: conversation.id, created: false };
  }
  const created = await prisma.imageConversation.create({
    data: { userId, title: prompt.trim().slice(0, 12) || "新会话" },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

function normalizedReferenceThumbs(value: string[] | undefined) {
  if (!value?.length) return null;
  const accepted = value
    .filter(
      (item) =>
        /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(item) &&
        item.length <= 512 * 1024,
    )
    .slice(0, 1);
  return accepted.length > 0 ? JSON.stringify(accepted) : null;
}

export async function enqueueImageTurn(
  options: EnqueueImageTurnOptions,
): Promise<SerializedTurn> {
  const { userId, prompt, ratio, quality, count, mode } = options;
  await assertImageOperationAllowed(userId);

  let resolved;
  try {
    resolved = await resolveImageProvider(
      userId,
      "IMAGE",
      options.model,
      options.modelSource,
    );
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      throw new TurnError(
        503,
        "图片服务尚未配置，请前往「API 设置」配置你的 API，或联系管理员",
      );
    }
    if (error instanceof ProviderConfigInvalidError) {
      throw new TurnError(503, error.message);
    }
    throw error;
  }
  if (mode === "edit" && typeof resolved.provider.edit !== "function") {
    throw new TurnError(400, "当前图片服务不支持图生图");
  }
  if (mode === "edit" && !options.editImage) {
    throw new TurnError(400, "请上传参考图");
  }

  const qualityMeta = IMAGE_QUALITY_META[quality];
  const globalUnitCost = await getSettingNumber(SETTING_KEYS.IMAGE_CREDIT_COST);
  const unitCost =
    (resolved.creditCostOverride ?? globalUnitCost) * qualityMeta.costMultiplier;
  const totalCost = resolved.useOwnKey ? 0 : unitCost * count;
  if (!Number.isSafeInteger(totalCost) || totalCost < 0) {
    throw new TurnError(500, "图片模型积分配置无效");
  }

  const conversation = await ensureConversation(
    userId,
    options.conversationId,
    prompt,
  );
  let editInput:
    | Awaited<ReturnType<typeof saveImageEditInput>>
    | undefined;
  try {
    if (mode === "edit" && options.editImage) {
      editInput = await saveImageEditInput(
        userId,
        options.editImage.blob,
        options.editImage.filename,
      );
    }

    const initialImages: TurnImage[] = Array.from(
      { length: count },
      (_, index) => ({
        id: String(index),
        status: "queued",
        quality: qualityMeta.label,
      }),
    );
    const maxPending = getImageUserMaxPending();
    const turn = await prisma.$transaction(async (tx) => {
      const capacity = await checkImageQueueCapacity(tx);
      if (!capacity.allowed) {
        throw new TurnError(503, "当前图片生成任务较多，请稍后再试");
      }
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const pending = await tx.imageTurn.count({
        where: { status: "PENDING", conversation: { userId } },
      });
      if (pending >= maxPending) {
        throw new TurnError(
          429,
          `同时等待或生成的图片任务不能超过 ${maxPending} 个`,
        );
      }
      if (totalCost > 0) {
        await consumeCreditsInTransaction(
          tx,
          userId,
          totalCost,
          `图片生成 ×${count}`,
        );
      }
      const created = await tx.imageTurn.create({
        data: {
          conversationId: conversation.id,
          prompt,
          mode,
          model: resolved.model,
          providerSource: resolved.source,
          ratio,
          quality,
          pixelSize: RATIO_TO_PIXEL[ratio],
          count,
          status: "PENDING",
          images: JSON.stringify(initialImages),
          referenceThumbs: normalizedReferenceThumbs(options.referenceThumbs),
          editInputPath: editInput?.token,
          editInputName: editInput?.filename,
          creditsCost: totalCost,
          usedOwnKey: resolved.useOwnKey,
        },
      });
      await tx.imageConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    return serializeTurn(turn);
  } catch (error) {
    await deleteImageEditInput(userId, editInput?.token ?? null).catch(
      () => undefined,
    );
    if (conversation.created) {
      await prisma.imageConversation
        .deleteMany({ where: { id: conversation.id, turns: { none: {} } } })
        .catch(() => undefined);
    }
    if (error instanceof InsufficientCreditsError) {
      throw new TurnError(
        402,
        `积分不足，需要 ${error.required}，当前 ${error.balance}`,
      );
    }
    throw error;
  }
}

export async function claimNextImageTurn(): Promise<ClaimedImageTurn | null> {
  const lease = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "ImageTurn"
    SET
      "workerLease" = ${lease},
      "startedAt" = NOW(),
      "heartbeatAt" = NOW(),
      "attemptCount" = "attemptCount" + 1,
      "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "ImageTurn"
      WHERE "status" = 'PENDING'::"GenerationStatus"
        AND "workerLease" IS NULL
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"
  `;
  return rows[0] ? { id: rows[0].id, lease } : null;
}

async function heartbeatImageTurn(turnId: string, lease: string) {
  const rows = await prisma.$queryRaw<
    Array<{ cancelRequestedAt: Date | null }>
  >`
    UPDATE "ImageTurn"
    SET "heartbeatAt" = NOW(), "updatedAt" = NOW()
    WHERE "id" = ${turnId}
      AND "status" = 'PENDING'::"GenerationStatus"
      AND "workerLease" = ${lease}
    RETURNING "cancelRequestedAt"
  `;
  return rows[0] ?? null;
}

async function persistTurnImages(
  turnId: string,
  lease: string,
  images: TurnImage[],
) {
  const updated = await prisma.imageTurn.updateMany({
    where: { id: turnId, status: "PENDING", workerLease: lease },
    data: { images: JSON.stringify(images), heartbeatAt: new Date() },
  });
  if (updated.count !== 1) throw new ImageLeaseLostError();
}

async function finalizeImageTurn({
  turn,
  expectedLease,
  results,
  errorOverride,
  durationMs,
}: {
  turn: ImageTurn & { conversation: { userId: string } };
  expectedLease: string | null;
  results: TurnImage[];
  errorOverride?: string;
  durationMs: number;
}): Promise<SerializedTurn> {
  const successUrls = results
    .filter((result) => result.status === "success" && result.url)
    .map((result) => result.url!);
  const successCount = successUrls.length;
  const failedCount = Math.max(0, turn.count - successCount);
  const unitCost =
    !turn.usedOwnKey && turn.count > 0
      ? Math.floor(turn.creditsCost / turn.count)
      : 0;
  const actualCost = turn.usedOwnKey ? 0 : unitCost * successCount;
  const refundAmount = Math.max(0, turn.creditsCost - actualCost);
  const status: GenerationStatus = successCount > 0 ? "SUCCESS" : "FAILED";
  const error =
    errorOverride ?? summarizeTurnError(results, failedCount, successCount);
  const upstreamStatus = firstUpstreamStatus(results);

  const finalized = await prisma.$transaction(async (tx) => {
    const claimed = await tx.imageTurn.updateMany({
      where: {
        id: turn.id,
        status: "PENDING",
        workerLease: expectedLease,
      },
      data: {
        status,
        images: JSON.stringify(results),
        creditsCost: actualCost,
        error,
        upstreamStatus,
        durationMs,
        workerLease: null,
        heartbeatAt: null,
      },
    });
    if (claimed.count !== 1) return null;

    if (refundAmount > 0) {
      const refunded = await tx.user.update({
        where: { id: turn.conversation.userId },
        data: { credits: { increment: refundAmount } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: turn.conversation.userId,
          amount: refundAmount,
          type: "REFUND",
          balanceAfter: refunded.credits,
          description: errorOverride?.includes("停止")
            ? `图片生成停止退款 ×${failedCount}`
            : `图片生成失败退款 ×${failedCount}`,
        },
      });
    }

    const generation = await tx.generation.create({
      data: {
        userId: turn.conversation.userId,
        module: "IMAGE",
        prompt: turn.prompt,
        params: JSON.stringify({
          mode: turn.mode,
          ratio: turn.ratio,
          quality: turn.quality,
          pixelSize: turn.pixelSize,
          count: turn.count,
          conversationId: turn.conversationId,
          turnId: turn.id,
        }),
        status,
        resultUrl:
          successUrls.length > 0 ? JSON.stringify(successUrls) : null,
        creditsCost: actualCost,
        usedOwnKey: turn.usedOwnKey,
        error,
        providerSource: turn.providerSource,
        providerModel: turn.model,
        upstreamStatus,
        durationMs,
        imageCount: turn.count,
        successCount,
        failedCount,
      },
      select: { id: true },
    });
    return tx.imageTurn.update({
      where: { id: turn.id },
      data: { generationId: generation.id },
    });
  });

  const current =
    finalized ?? (await prisma.imageTurn.findUnique({ where: { id: turn.id } }));
  if (!current) throw new Error("图片任务不存在");
  if (current.status !== "PENDING") {
    await deleteImageEditInput(
      turn.conversation.userId,
      turn.editInputPath,
    ).catch((cleanupError) => {
      logger.warn("image-worker", "清理图生图参考文件失败", {
        turnId: turn.id,
        error: cleanupError,
      });
    });
  }
  return serializeTurn(current);
}

async function withTransientRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
) {
  const maxAttempts = getImageUpstreamMaxAttempts();
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const status = getUpstreamStatus(error);
      const retryable =
        error instanceof UpstreamImageError &&
        (status === null || [429, 500, 502, 503, 504, 524].includes(status));
      if (!retryable || attempt >= maxAttempts || signal.aborted) throw error;
      await sleep(Math.min(4_000, 750 * 2 ** (attempt - 1)), signal);
    }
  }
  throw lastError;
}

export async function executeImageTurn(
  turnId: string,
  lease: string,
  parentSignal?: AbortSignal,
) {
  const turn = await prisma.imageTurn.findUnique({
    where: { id: turnId },
    include: { conversation: { select: { userId: true } } },
  });
  if (
    !turn ||
    turn.status !== "PENDING" ||
    turn.workerLease !== lease
  ) {
    return turn ? serializeTurn(turn) : null;
  }

  const controller = new AbortController();
  const abortFromParent = () =>
    controller.abort(parentSignal?.reason ?? new ImageWorkerShutdownError());
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  let heartbeatInFlight: Promise<void> | null = null;
  const refreshHeartbeat = () => {
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = heartbeatImageTurn(turn.id, lease)
      .then((heartbeat) => {
        if (!heartbeat) {
          controller.abort(new ImageLeaseLostError());
        } else if (heartbeat.cancelRequestedAt) {
          controller.abort("用户已停止生成");
        }
      })
      .catch((error) => {
        logger.error("image-worker", "图片任务心跳失败", {
          turnId: turn.id,
          error,
        });
        controller.abort(
          new ImageWorkerRetryError("图片任务数据库心跳失败，稍后自动重试"),
        );
      })
      .finally(() => {
        heartbeatInFlight = null;
      });
  };
  const heartbeatTimer = setInterval(refreshHeartbeat, IMAGE_HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

  const startedAt = Date.now();
  const userId = turn.conversation.userId;
  const quality = asQuality(turn.quality);
  const qualityMeta = IMAGE_QUALITY_META[quality];
  const ratio = asRatio(turn.ratio);
  let results = normalizeTurnImages(turn);

  try {
    refreshHeartbeat();
    await heartbeatInFlight;
    throwControlAbort(controller.signal);
    if (controller.signal.aborted) {
      results = failedImages(turn, "用户已停止生成");
      return finalizeImageTurn({
        turn,
        expectedLease: lease,
        results,
        errorOverride: "用户已停止生成",
        durationMs: Date.now() - turn.createdAt.getTime(),
      });
    }

    const resolved = await resolveImageProvider(
      userId,
      "IMAGE",
      turn.model,
      turn.providerSource === "user" || turn.providerSource === "platform"
        ? turn.providerSource
        : undefined,
    );
    if (turn.mode === "edit" && typeof resolved.provider.edit !== "function") {
      throw new Error("当前图片服务不支持图生图");
    }
    const configuredParallelLimit = await getSettingNumber(
      SETTING_KEYS.IMAGE_PARALLEL_LIMIT,
    );
    const parallelLimit = Math.min(
      clampImageParallelLimit(configuredParallelLimit),
      turn.count,
    );
    const requestTimeoutMs = imageRequestTimeoutMs(
      await getSettingNumber(SETTING_KEYS.IMAGE_REQUEST_TIMEOUT_SECONDS),
    );

    let imageWriteQueue = Promise.resolve();
    const persistImage = async (image: TurnImage) => {
      imageWriteQueue = imageWriteQueue.then(() =>
        persistTurnImages(turn.id, lease, results),
      );
      await imageWriteQueue;
      return image;
    };
    const pendingIndices = results
      .map((image, index) => (image.status === "success" ? -1 : index))
      .filter((index) => index >= 0);

    if (turn.mode === "edit") {
      if (!turn.editInputPath) throw new Error("图生图参考文件已过期，请重新提交");
      const editImage = await readImageEditInput(userId, turn.editInputPath);
      for (const index of pendingIndices) {
        results[index] = {
          id: String(index),
          status: "loading",
          quality: qualityMeta.label,
        };
      }
      await persistTurnImages(turn.id, lease, results);
      try {
        const imageStartedAt = Date.now();
        const output = await withTransientRetry(
          () =>
            resolved.provider.edit!({
              prompt: turn.prompt,
              image: editImage,
              imageFilename: turn.editInputName || "reference.png",
              size: RATIO_TO_PIXEL[ratio],
              quality: qualityMeta.providerQuality,
              count: pendingIndices.length,
              signal: controller.signal,
              timeoutMs: requestTimeoutMs,
            }),
          controller.signal,
        );
        const elapsedMs = output.elapsedMs ?? Date.now() - imageStartedAt;
        for (let offset = 0; offset < pendingIndices.length; offset += 1) {
          const index = pendingIndices[offset];
          const url = output.urls[offset];
          if (!url) {
            results[index] = {
              id: String(index),
              status: "error",
              error: "上游未返回图片",
              durationMs: elapsedMs,
              quality: qualityMeta.label,
            };
          } else {
            try {
              results[index] = {
                id: String(index),
                status: "success",
                url: await persistGeneratedImageUrl(url, userId, turn.id, index),
                durationMs: elapsedMs,
                quality: qualityMeta.label,
              };
            } catch (error) {
              results[index] = {
                id: String(index),
                status: "error",
                error: getErrorMessage(error, "图片保存失败"),
                durationMs: elapsedMs,
                quality: qualityMeta.label,
              };
            }
          }
          await persistImage(results[index]);
        }
      } catch (error) {
        throwControlAbort(controller.signal);
        const message = controller.signal.aborted
          ? "用户已停止生成"
          : getErrorMessage(error);
        for (const index of pendingIndices) {
          results[index] = {
            id: String(index),
            status: "error",
            error: message,
            upstreamStatus: getUpstreamStatus(error) ?? undefined,
            quality: qualityMeta.label,
          };
        }
        await persistTurnImages(turn.id, lease, results);
      }
    } else {
      await runWithConcurrency(pendingIndices, parallelLimit, async (index) => {
        throwControlAbort(controller.signal);
        if (controller.signal.aborted) throw new Error("用户已停止生成");
        results[index] = {
          id: String(index),
          status: "loading",
          quality: qualityMeta.label,
        };
        await persistImage(results[index]);
        const imageStartedAt = Date.now();
        try {
          const output = await withTransientRetry(
            () =>
              resolved.provider.generate({
                prompt: turn.prompt,
                size: RATIO_TO_PIXEL[ratio],
                quality: qualityMeta.providerQuality,
                count: 1,
                signal: controller.signal,
                timeoutMs: requestTimeoutMs,
              }),
            controller.signal,
          );
          const url = output.urls[0];
          if (!url) throw new Error("上游未返回图片");
          results[index] = {
            id: String(index),
            status: "success",
            url: await persistGeneratedImageUrl(url, userId, turn.id, index),
            durationMs: output.elapsedMs ?? Date.now() - imageStartedAt,
            quality: qualityMeta.label,
          };
        } catch (error) {
          throwControlAbort(controller.signal);
          results[index] = {
            id: String(index),
            status: "error",
            error: controller.signal.aborted
              ? "用户已停止生成"
              : getErrorMessage(error),
            upstreamStatus: getUpstreamStatus(error) ?? undefined,
            durationMs: Date.now() - imageStartedAt,
            quality: qualityMeta.label,
          };
        }
        await persistImage(results[index]);
      });
    }

    const stopped =
      controller.signal.aborted && !isShutdownSignal(controller.signal);
    return finalizeImageTurn({
      turn,
      expectedLease: lease,
      results,
      errorOverride: stopped ? "用户已停止生成" : undefined,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    if (
      error instanceof ImageWorkerShutdownError ||
      isShutdownSignal(controller.signal)
    ) {
      throw new ImageWorkerShutdownError();
    }
    if (error instanceof ImageWorkerRetryError) throw error;
    if (error instanceof ImageLeaseLostError) {
      const current = await prisma.imageTurn.findUnique({ where: { id: turn.id } });
      return current ? serializeTurn(current) : null;
    }
    const message = controller.signal.aborted
      ? "用户已停止生成"
      : getErrorMessage(error);
    results = results.map((image) =>
      image.status === "success"
        ? image
        : {
            ...image,
            status: "error" as const,
            error: message,
            upstreamStatus: getUpstreamStatus(error) ?? undefined,
          },
    );
    return finalizeImageTurn({
      turn,
      expectedLease: lease,
      results,
      errorOverride: message,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    clearInterval(heartbeatTimer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

async function runWithConcurrency(
  indices: number[],
  limit: number,
  task: (index: number) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, indices.length) },
    async () => {
      while (next < indices.length) {
        const index = indices[next];
        next += 1;
        await task(index);
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((item) => item.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

export async function requeueImageTurn(turnId: string, lease: string) {
  const turn = await prisma.imageTurn.findUnique({ where: { id: turnId } });
  if (!turn || turn.status !== "PENDING" || turn.workerLease !== lease) return false;
  const images = normalizeTurnImages(turn);
  const updated = await prisma.imageTurn.updateMany({
    where: { id: turnId, status: "PENDING", workerLease: lease },
    data: {
      workerLease: null,
      startedAt: null,
      heartbeatAt: null,
      images: JSON.stringify(images),
    },
  });
  return updated.count === 1;
}

export async function cancelImageTurn(userId: string, turnId: string) {
  let turn = await prisma.imageTurn.findFirst({
    where: { id: turnId, conversation: { userId } },
    include: { conversation: { select: { userId: true } } },
  });
  if (!turn) throw new TurnError(404, "生成任务不存在");
  if (turn.status !== "PENDING") return serializeTurn(turn);

  if (turn.workerLease === null) {
    const cancelled = await finalizeImageTurn({
      turn,
      expectedLease: null,
      results: failedImages(turn, "用户已停止生成"),
      errorOverride: "用户已停止生成",
      durationMs: Date.now() - turn.createdAt.getTime(),
    });
    if (cancelled.status !== "PENDING") return cancelled;
  }

  await prisma.imageTurn.updateMany({
    where: { id: turnId, status: "PENDING" },
    data: { cancelRequestedAt: new Date() },
  });
  const deadline = Date.now() + 6_000;
  while (Date.now() < deadline) {
    await sleep(250);
    turn = await prisma.imageTurn.findFirst({
      where: { id: turnId, conversation: { userId } },
      include: { conversation: { select: { userId: true } } },
    });
    if (!turn) throw new TurnError(404, "生成任务不存在");
    if (turn.status !== "PENDING") return serializeTurn(turn);
  }
  return serializeTurn(turn);
}

export async function sweepStaleImageTurns(
  timeoutMs = IMAGE_WORKER_STALE_TIMEOUT_MS,
) {
  const before = new Date(Date.now() - timeoutMs);
  const maxAttempts = getImageWorkerMaxAttempts();
  const stale = await prisma.imageTurn.findMany({
    where: {
      status: "PENDING",
      workerLease: { not: null },
      OR: [{ heartbeatAt: { lt: before } }, { heartbeatAt: null }],
    },
    include: { conversation: { select: { userId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  let requeued = 0;
  let failed = 0;
  for (const turn of stale) {
    if (!turn.workerLease) continue;
    if (turn.attemptCount < maxAttempts && !turn.cancelRequestedAt) {
      if (await requeueImageTurn(turn.id, turn.workerLease)) requeued += 1;
      continue;
    }
    const message = turn.cancelRequestedAt
      ? "用户已停止生成"
      : "图片任务多次中断，已自动停止并退款";
    const result = await finalizeImageTurn({
      turn,
      expectedLease: turn.workerLease,
      results: failedImages(turn, message),
      errorOverride: message,
      durationMs: Date.now() - turn.createdAt.getTime(),
    });
    if (result.status !== "PENDING") failed += 1;
  }
  return { scanned: stale.length, requeued, failed };
}

export async function failStuckImageTurns(
  timeoutMs = IMAGE_WORKER_STALE_TIMEOUT_MS,
) {
  const before = new Date(Date.now() - timeoutMs);
  const stale = await prisma.imageTurn.findMany({
    where: { status: "PENDING", createdAt: { lt: before } },
    include: { conversation: { select: { userId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  let updatedCount = 0;
  let refundedCredits = 0;
  for (const turn of stale) {
    const beforeCredits = turn.creditsCost;
    const result = await finalizeImageTurn({
      turn,
      expectedLease: turn.workerLease,
      results: failedImages(turn, "任务超时，已自动停止处理"),
      errorOverride: "任务超时，已自动标记失败并退还未完成图片积分",
      durationMs: Date.now() - turn.createdAt.getTime(),
    });
    if (result.status !== "PENDING") {
      updatedCount += 1;
      refundedCredits += Math.max(0, beforeCredits - result.creditsCost);
    }
  }
  return { updatedCount, refundedCredits };
}

export async function streamImageTurn(
  initial: SerializedTurn,
  onEvent: (event: ImageTurnProgressEvent) => void,
  signal?: AbortSignal,
) {
  onEvent({
    type: "created",
    turn: initial,
    conversationId: initial.conversationId,
  });
  let previous = initial;
  while (previous.status === "PENDING" && !signal?.aborted) {
    await sleep(IMAGE_STREAM_POLL_MS, signal).catch(() => undefined);
    if (signal?.aborted) return;
    const row = await prisma.imageTurn.findUnique({ where: { id: initial.id } });
    if (!row) throw new Error("图片任务不存在");
    const current = serializeTurn(row);
    const previousById = new Map(
      previous.images.map((image) => [image.id, JSON.stringify(image)]),
    );
    for (const image of current.images) {
      if (previousById.get(image.id) !== JSON.stringify(image)) {
        onEvent({ type: "image", turnId: current.id, image });
      }
    }
    previous = current;
  }
  if (!signal?.aborted) {
    onEvent({
      type: "final",
      turn: previous,
      conversationId: previous.conversationId,
    });
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (typeof timer.unref === "function") timer.unref();
  });
}

export type ImageTurnTransactionClient = Pick<
  Prisma.TransactionClient,
  "imageTurn" | "imageConversation" | "generation" | "user" | "creditTransaction"
>;
