import { prisma } from "@/lib/db";
import {
  consumeCredits,
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
import { IMAGE_QUALITY_META, type ImageQuality } from "@/lib/image-quality";
import { RATIO_TO_PIXEL, type AspectRatio } from "@/lib/providers/types";
import { UpstreamImageError } from "@/lib/providers/types";
import { saveImageFromUrl } from "@/lib/materials";
import type { GenerationStatus, ImageTurn } from "@prisma/client";

// 工作台单张图片的状态（与前端 StoredImage 对齐，存入 ImageTurn.images JSON）
export interface TurnImage {
  id: string;
  status: "queued" | "loading" | "success" | "error";
  url?: string;
  error?: string;
  upstreamStatus?: number;
}

// 前端友好的 Turn 形状（JSON 字段已解析）
export interface SerializedTurn {
  id: string;
  conversationId: string;
  prompt: string;
  mode: string;
  model: string;
  ratio: string;
  count: number;
  status: string;
  images: TurnImage[];
  referenceThumbs: string[];
  error: string | null;
  creditsCost: number;
  usedOwnKey: boolean;
  generationId: string | null;
  createdAt: string;
}

export type ImageTurnProgressEvent =
  | { type: "created"; turn: SerializedTurn; conversationId: string }
  | { type: "image"; turnId: string; image: TurnImage }
  | { type: "final"; turn: SerializedTurn; conversationId: string };

type ProgressHandler = RunTurnOptions["onProgress"];

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

function getErrorMessage(e: unknown, fallback = "生成失败") {
  return e instanceof Error && e.message ? e.message : fallback;
}

function getUpstreamStatus(e: unknown) {
  return e instanceof UpstreamImageError ? e.status ?? null : null;
}

function firstUpstreamStatus(results: TurnImage[]) {
  return results.find((r) => r.upstreamStatus)?.upstreamStatus ?? null;
}

function summarizeTurnError(results: TurnImage[], failedCount: number, successCount: number) {
  if (failedCount === 0) return null;
  const firstError = results.find((r) => r.status === "error" && r.error)?.error;
  if (successCount === 0) return firstError || "全部生成失败";
  return firstError ? `其中 ${failedCount} 张未成功：${firstError}` : `其中 ${failedCount} 张未成功`;
}

async function persistGeneratedImageUrl(url: string, userId: string, turnId: string, index: number) {
  if (!url.startsWith("data:")) return url;
  const stored = await saveImageFromUrl(url, `${userId}-${turnId}-${index}`);
  return stored.url;
}

async function emitProgress(handler: ProgressHandler, event: ImageTurnProgressEvent) {
  try {
    await handler?.(event);
  } catch (e) {
    console.warn("[image-turn] progress event dropped:", getErrorMessage(e, "推送进度失败"));
  }
}

// 把 Prisma ImageTurn 行转为前端友好形状（解析 images/referenceThumbs JSON）
export function serializeTurn(turn: ImageTurn): SerializedTurn {
  return {
    id: turn.id,
    conversationId: turn.conversationId,
    prompt: turn.prompt,
    mode: turn.mode,
    model: turn.model,
    ratio: turn.ratio,
    count: turn.count,
    status: turn.status,
    images: safeParseArray<TurnImage>(turn.images),
    referenceThumbs: safeParseArray<string>(turn.referenceThumbs),
    error: turn.error,
    creditsCost: turn.creditsCost,
    usedOwnKey: turn.usedOwnKey,
    generationId: turn.generationId,
    createdAt: turn.createdAt.toISOString(),
  };
}

// 业务错误：携带 HTTP 状态码，route 层据此返回
export class TurnError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "TurnError";
  }
}

export const STUCK_IMAGE_TURN_TIMEOUT_MS = 10 * 60 * 1000;

interface RunTurnOptions {
  userId: string;
  conversationId?: string;
  prompt: string;
  ratio: AspectRatio;
  quality: ImageQuality;
  count: number;
  model?: string;
  mode: "generate" | "edit";
  // 图生图时提供：参考图二进制 + 文件名 + 展示缩略图
  editImage?: { blob: Blob; filename: string };
  referenceThumbs?: string[];
  onProgress?: (event: ImageTurnProgressEvent) => Promise<void> | void;
}

async function runWithConcurrency(
  count: number,
  limit: number,
  task: (index: number) => Promise<void>
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, count) }, async () => {
    while (next < count) {
      const index = next;
      next += 1;
      await task(index);
    }
  });
  const settled = await Promise.allSettled(workers);
  const failed = settled.find((item) => item.status === "rejected");
  if (failed?.status === "rejected") {
    throw failed.reason;
  }
}

// 确保会话存在：传入 id 则校验归属，否则用首句话当标题新建。
async function ensureConversation(
  userId: string,
  conversationId: string | undefined,
  prompt: string
): Promise<string> {
  if (conversationId) {
    const conv = await prisma.imageConversation.findUnique({
      where: { id: conversationId },
      select: { id: true, userId: true },
    });
    if (!conv || conv.userId !== userId) {
      throw new TurnError(404, "会话不存在");
    }
    return conv.id;
  }
  const title = prompt.trim().slice(0, 12) || "新会话";
  const created = await prisma.imageConversation.create({
    data: { userId, title },
    select: { id: true },
  });
  return created.id;
}

async function finalizeImageTurn({
  turnId,
  userId,
  conversationId,
  prompt,
  mode,
  ratio,
  quality,
  pixelSize,
  count,
  results,
  unitCost,
  useOwnKey,
  providerSource,
  providerModel,
  durationMs,
  errorOverride,
}: {
  turnId: string;
  userId: string;
  conversationId: string;
  prompt: string;
  mode: "generate" | "edit";
  ratio: AspectRatio;
  quality: ImageQuality;
  pixelSize: string;
  count: number;
  results: TurnImage[];
  unitCost: number;
  useOwnKey: boolean;
  providerSource: string;
  providerModel: string;
  durationMs: number;
  errorOverride?: string;
}) {
  const successUrls = results.filter((r) => r.status === "success").map((r) => r.url!);
  const successCount = successUrls.length;
  const failedCount = count - successCount;
  const actualCost = useOwnKey ? 0 : unitCost * successCount;
  const turnStatus: GenerationStatus = successCount === 0 ? "FAILED" : "SUCCESS";
  const turnError = errorOverride ?? summarizeTurnError(results, failedCount, successCount);
  const upstreamStatus = firstUpstreamStatus(results);

  const updated = await prisma.$transaction(async (tx) => {
    if (!useOwnKey && unitCost > 0 && failedCount > 0) {
      const refundAmount = unitCost * failedCount;
      const refunded = await tx.user.update({
        where: { id: userId },
        data: { credits: { increment: refundAmount } },
      });
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: refundAmount,
          type: "REFUND",
          balanceAfter: refunded.credits,
          description: `图片生成失败退款 ×${failedCount}`,
        },
      });
    }

    const generation = await tx.generation.create({
      data: {
        userId,
        module: "IMAGE",
        prompt,
        params: JSON.stringify({ mode, ratio, quality, pixelSize, count, conversationId, turnId }),
        status: turnStatus,
        resultUrl: successUrls.length > 0 ? JSON.stringify(successUrls) : null,
        creditsCost: actualCost,
        usedOwnKey: useOwnKey,
        error: turnError,
        providerSource,
        providerModel,
        upstreamStatus,
        durationMs,
        imageCount: count,
        successCount,
        failedCount,
      },
      select: { id: true },
    });

    const finalTurn = await tx.imageTurn.update({
      where: { id: turnId },
      data: {
        status: turnStatus,
        images: JSON.stringify(results),
        creditsCost: actualCost,
        error: turnError,
        providerSource,
        upstreamStatus,
        durationMs,
        generationId: generation.id,
      },
    });

    await tx.imageConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return finalTurn;
  });

  return serializeTurn(updated);
}

// 跑完整一轮：分流 → 扣费 → 并发逐张生成 → 退款 → 写 Turn + 兼容 Generation。
// 返回更新后的 Turn 行（含 conversationId）。
export async function runImageTurn(options: RunTurnOptions) {
  const { userId, prompt, ratio, quality, count, mode } = options;
  const startedAt = Date.now();

  try {
    await assertModuleOperationAllowed(userId, "IMAGE");
  } catch (e) {
    if (e instanceof OperationBlockedError) {
      throw new TurnError(e.status, e.message);
    }
    throw e;
  }

  // 1. 分流（未配置 → 503）
  let resolved;
  try {
    resolved = await resolveImageProvider(userId, "IMAGE", options.model);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      throw new TurnError(503, "图片服务尚未配置，请前往「API 设置」配置你的 API，或联系管理员");
    }
    if (e instanceof ProviderConfigInvalidError) {
      throw new TurnError(503, e.message);
    }
    throw e;
  }
  const { provider, useOwnKey, model, creditCostOverride, source } = resolved;

  // 图生图但 provider 不支持 edit
  if (mode === "edit" && typeof provider.edit !== "function") {
    throw new TurnError(400, "当前图片服务不支持图生图");
  }

  const pixelSize = RATIO_TO_PIXEL[ratio];
  const qualityMeta = IMAGE_QUALITY_META[quality];
  const globalUnitCost = await getSettingNumber(SETTING_KEYS.IMAGE_CREDIT_COST);
  const unitCost = (creditCostOverride ?? globalUnitCost) * qualityMeta.costMultiplier;
  const configuredParallelLimit = await getSettingNumber(SETTING_KEYS.IMAGE_PARALLEL_LIMIT);
  const parallelLimit = Math.min(clampImageParallelLimit(configuredParallelLimit), count);
  const totalCost = useOwnKey ? 0 : unitCost * count;

  // 2. 确保会话 + 建 Turn（PENDING，按并行数区分生成中/等待中）
  const conversationId = await ensureConversation(userId, options.conversationId, prompt);
  const activeSlots = mode === "edit" ? count : parallelLimit;
  const initialImages: TurnImage[] = Array.from({ length: count }, (_, i) => ({
    id: `${i}`,
    status: i < activeSlots ? "loading" : "queued",
  }));
  const turn = await prisma.imageTurn.create({
    data: {
      conversationId,
      prompt,
      mode,
      model,
      ratio,
      pixelSize,
      count,
      status: "PENDING",
      images: JSON.stringify(initialImages),
      referenceThumbs: options.referenceThumbs
        ? JSON.stringify(options.referenceThumbs)
        : null,
      creditsCost: totalCost,
      usedOwnKey: useOwnKey,
      providerSource: source,
    },
  });
  await prisma.imageConversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // 3. 扣积分（平台模式）。不足则删 Turn 返回 402。
  if (totalCost > 0) {
    try {
      await consumeCredits(userId, totalCost, `图片生成 ×${count}`);
    } catch (e) {
      await prisma.imageTurn.delete({ where: { id: turn.id } });
      if (e instanceof InsufficientCreditsError) {
        throw new TurnError(402, `积分不足，需要 ${e.required}，当前 ${e.balance}`);
      }
      throw new TurnError(500, "扣费失败");
    }
  }

  await emitProgress(options.onProgress, {
    type: "created",
    turn: serializeTurn(turn),
    conversationId,
  });

  // 4. 并发逐张生成：每张独立成功/失败，并实时回写槽位。
  const results: TurnImage[] = [...initialImages];
  let imageWriteQueue = Promise.resolve();
  async function persistAndEmitImage(image: TurnImage) {
    imageWriteQueue = imageWriteQueue.then(async () => {
      await prisma.imageTurn.update({
        where: { id: turn.id },
        data: { images: JSON.stringify(results) },
      });
      await emitProgress(options.onProgress, {
        type: "image",
        turnId: turn.id,
        image,
      });
    });
    await imageWriteQueue;
  }

  let interruptedError: string | undefined;
  try {
    if (mode === "edit") {
      try {
        const out = await provider.edit!({
          prompt,
          image: options.editImage!.blob,
          imageFilename: options.editImage!.filename,
          size: pixelSize,
          quality: qualityMeta.providerQuality,
          count,
        });
        for (let i = 0; i < count; i += 1) {
          const url = out.urls[i];
          if (!url) {
            results[i] = { id: `${i}`, status: "error", error: "上游未返回图片" };
          } else {
            try {
              results[i] = {
                id: `${i}`,
                status: "success",
                url: await persistGeneratedImageUrl(url, userId, turn.id, i),
              };
            } catch (e) {
              results[i] = { id: `${i}`, status: "error", error: getErrorMessage(e, "图片保存失败") };
            }
          }
          await persistAndEmitImage(results[i]);
        }
      } catch (e) {
        const msg = getErrorMessage(e);
        const upstreamStatus = getUpstreamStatus(e) ?? undefined;
        for (let i = 0; i < count; i += 1) {
          results[i] = { id: `${i}`, status: "error", error: msg, upstreamStatus };
          await persistAndEmitImage(results[i]);
        }
      }
    } else {
      await runWithConcurrency(count, parallelLimit, async (i) => {
        if (results[i].status !== "loading") {
          results[i] = { id: `${i}`, status: "loading" };
          await persistAndEmitImage(results[i]);
        }

        try {
          const out = await provider.generate({
            prompt,
            size: pixelSize,
            quality: qualityMeta.providerQuality,
            count: 1,
          });
          const url = out.urls[0];
          if (!url) throw new Error("未返回图片");
          results[i] = {
            id: `${i}`,
            status: "success",
            url: await persistGeneratedImageUrl(url, userId, turn.id, i),
          };
        } catch (e) {
          const msg = getErrorMessage(e);
          results[i] = {
            id: `${i}`,
            status: "error",
            error: msg,
            upstreamStatus: getUpstreamStatus(e) ?? undefined,
          };
        }

        await persistAndEmitImage(results[i]);
      });
    }
  } catch (e) {
    const msg = getErrorMessage(e, "任务中断");
    for (let i = 0; i < results.length; i += 1) {
      if (results[i].status === "queued" || results[i].status === "loading") {
        results[i] = {
          id: `${i}`,
          status: "error",
          error: msg,
          upstreamStatus: getUpstreamStatus(e) ?? undefined,
        };
      }
    }
    interruptedError = `任务中断：${msg}`;
  }

  const serialized = await finalizeImageTurn({
    turnId: turn.id,
    userId,
    conversationId,
    prompt,
    mode,
    ratio,
    quality,
    pixelSize,
    count,
    results,
    unitCost,
    useOwnKey,
    providerSource: source,
    providerModel: model,
    durationMs: Date.now() - startedAt,
    errorOverride: interruptedError,
  });

  await emitProgress(options.onProgress, {
    type: "final",
    turn: serialized,
    conversationId,
  });

  return serialized;
}

export async function failStuckImageTurns(timeoutMs = STUCK_IMAGE_TURN_TIMEOUT_MS) {
  const before = new Date(Date.now() - timeoutMs);
  const stuckTurns = await prisma.imageTurn.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: before },
    },
    include: {
      conversation: { select: { id: true, userId: true } },
    },
    take: 100,
  });

  let updatedCount = 0;
  let refundedCredits = 0;

  for (const turn of stuckTurns) {
    const results = safeParseArray<TurnImage>(turn.images).map((image) =>
      image.status === "queued" || image.status === "loading"
        ? { ...image, status: "error" as const, error: "任务超时，已停止处理" }
        : image
    );
    const successUrls = results
      .filter((image) => image.status === "success" && image.url)
      .map((image) => image.url!);
    const successCount = successUrls.length;
    const failedCount = Math.max(0, turn.count - successCount);
    const unitCost =
      !turn.usedOwnKey && turn.count > 0 ? Math.floor(turn.creditsCost / turn.count) : 0;
    const actualCost = turn.usedOwnKey ? 0 : unitCost * successCount;
    const refundAmount = Math.max(0, turn.creditsCost - actualCost);
    const error = "任务超时，已自动标记失败并退还未完成图片积分";
    const durationMs = Date.now() - turn.createdAt.getTime();

    await prisma.$transaction(async (tx) => {
      if (!turn.usedOwnKey && refundAmount > 0) {
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
            description: `图片任务超时退款 ×${failedCount}`,
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
            pixelSize: turn.pixelSize,
            count: turn.count,
            conversationId: turn.conversationId,
            turnId: turn.id,
            timeout: true,
          }),
          status: successCount > 0 ? "SUCCESS" : "FAILED",
          resultUrl: successUrls.length > 0 ? JSON.stringify(successUrls) : null,
          creditsCost: actualCost,
          usedOwnKey: turn.usedOwnKey,
          error,
          providerSource: turn.providerSource,
          providerModel: turn.model,
          upstreamStatus: turn.upstreamStatus,
          durationMs,
          imageCount: turn.count,
          successCount,
          failedCount,
        },
        select: { id: true },
      });

      await tx.imageTurn.update({
        where: { id: turn.id },
        data: {
          status: successCount > 0 ? "SUCCESS" : "FAILED",
          images: JSON.stringify(results),
          error,
          creditsCost: actualCost,
          durationMs,
          generationId: generation.id,
        },
      });
    });

    updatedCount += 1;
    refundedCredits += refundAmount;
  }

  return { updatedCount, refundedCredits };
}
