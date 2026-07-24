import { prisma } from "@/lib/db";
import {
  GENERATED_ARTIFACT_RETENTION_MS,
  getGeneratedArtifactExpiresAt,
  isGeneratedArtifactExpired,
} from "@/lib/generated-artifact-retention";
import {
  deleteImageEditInputs,
  parseStoredImageInputReferences,
} from "@/lib/image-inputs";
import { logger } from "@/lib/logger";
import { deleteUnreferencedMaterialFile } from "@/lib/material-storage-references";
import {
  materialStorageKeyBelongsToUser,
  materialStorageKeyFromUrl,
} from "@/lib/materials";
import { parseUploadStorageKey } from "@/lib/upload-storage";

const TERMINAL_IMAGE_STATUSES = ["SUCCESS", "FAILED"] as const;
const SWEEP_BATCH_SIZE = 50;

export interface ImageArtifactState {
  status: string;
  completedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  artifactsDeletedAt?: Date | string | null;
}

export interface ImageArtifactSweepResult {
  turnsExpired: number;
  filesRemoved: number;
  filesPreserved: number;
}

function imageArtifactCompletedAt(turn: ImageArtifactState) {
  if (!(TERMINAL_IMAGE_STATUSES as readonly string[]).includes(turn.status)) {
    return null;
  }
  return turn.completedAt ?? turn.updatedAt ?? null;
}

export function getImageArtifactExpiresAt(turn: ImageArtifactState) {
  return getGeneratedArtifactExpiresAt(imageArtifactCompletedAt(turn));
}

export function areImageArtifactsExpired(
  turn: ImageArtifactState,
  now = Date.now(),
) {
  return Boolean(
    turn.artifactsDeletedAt ||
      isGeneratedArtifactExpired(imageArtifactCompletedAt(turn), now),
  );
}

export function imageTurnStorageKeys(value: string | null | undefined) {
  const keys = new Set<string>();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const url = (item as { url?: unknown }).url;
      if (typeof url !== "string") continue;
      const storageKey = materialStorageKeyFromUrl(url);
      if (storageKey) keys.add(storageKey);
    }
  } catch {
    return [];
  }
  return [...keys];
}

export async function isImageTurnStorageKeyAccessibleByUser(
  storageKey: string,
  userId: string,
  now = Date.now(),
) {
  try {
    parseUploadStorageKey(storageKey);
  } catch {
    return false;
  }
  if (!materialStorageKeyBelongsToUser(storageKey, userId)) return false;

  const cutoff = new Date(now - GENERATED_ARTIFACT_RETENTION_MS);
  const turns = await prisma.imageTurn.findMany({
    where: {
      conversation: { userId },
      artifactsDeletedAt: null,
      images: { contains: storageKey },
      OR: [
        { status: "PENDING" },
        {
          status: { in: [...TERMINAL_IMAGE_STATUSES] },
          completedAt: { gt: cutoff },
        },
        {
          status: { in: [...TERMINAL_IMAGE_STATUSES] },
          completedAt: null,
          updatedAt: { gt: cutoff },
        },
      ],
    },
    select: { images: true },
    take: 20,
  });
  return turns.some((turn) =>
    imageTurnStorageKeys(turn.images).includes(storageKey),
  );
}

export async function sweepExpiredImageArtifacts(
  now = Date.now(),
): Promise<ImageArtifactSweepResult> {
  const cutoff = new Date(now - GENERATED_ARTIFACT_RETENTION_MS);
  const turns = await prisma.imageTurn.findMany({
    where: {
      status: { in: [...TERMINAL_IMAGE_STATUSES] },
      artifactsDeletedAt: null,
      OR: [
        { completedAt: { lte: cutoff } },
        { completedAt: null, updatedAt: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      status: true,
      images: true,
      editInputs: true,
      editInputPath: true,
      editInputName: true,
      generationId: true,
      conversation: { select: { userId: true } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: SWEEP_BATCH_SIZE,
  });

  const result: ImageArtifactSweepResult = {
    turnsExpired: 0,
    filesRemoved: 0,
    filesPreserved: 0,
  };
  for (const turn of turns) {
    const deletedAt = new Date(now);
    let claimed = false;
    try {
      claimed = await prisma.$transaction(async (tx) => {
        const updated = await tx.imageTurn.updateMany({
          where: {
            id: turn.id,
            status: turn.status,
            artifactsDeletedAt: null,
            OR: [
              { completedAt: { lte: cutoff } },
              { completedAt: null, updatedAt: { lte: cutoff } },
            ],
          },
          data: {
            artifactsDeletedAt: deletedAt,
            images: null,
            referenceThumbs: null,
            editInputs: null,
            editInputPath: null,
            editInputName: null,
          },
        });
        if (updated.count !== 1) return false;
        if (turn.generationId) {
          await tx.generation.updateMany({
            where: { id: turn.generationId },
            data: { resultUrl: null },
          });
        }
        return true;
      });
    } catch (error) {
      logger.warn("image-retention", "标记过期图片任务失败", {
        turnId: turn.id,
        error,
      });
    }
    if (!claimed) continue;

    result.turnsExpired += 1;
    const references = parseStoredImageInputReferences(
      turn.editInputs,
      turn.editInputPath,
      turn.editInputName,
    );
    await deleteImageEditInputs(turn.conversation.userId, references).catch(
      (error) => {
        logger.warn("image-retention", "清理过期图片任务参考文件失败", {
          turnId: turn.id,
          error,
        });
      },
    );

    for (const storageKey of imageTurnStorageKeys(turn.images)) {
      try {
        if (
          await isImageTurnStorageKeyAccessibleByUser(
            storageKey,
            turn.conversation.userId,
            now,
          )
        ) {
          result.filesPreserved += 1;
          continue;
        }
        const removed = await deleteUnreferencedMaterialFile(storageKey);
        if (removed) result.filesRemoved += 1;
        else result.filesPreserved += 1;
      } catch (error) {
        logger.warn("image-retention", "清理过期生成图片失败", {
          turnId: turn.id,
          storageKey,
          error,
        });
      }
    }
  }
  return result;
}
