"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteStoredMaterialFile,
  materialStorageKeyFromUrl,
  saveImageFromUrl,
  tagsToJson,
} from "@/lib/materials";
import { deleteUnreferencedMaterialFile } from "@/lib/material-storage-references";
import { resolveMaterialSubmissionState } from "@/lib/material-review";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { createMaterialReport } from "@/lib/material-reports";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";

const saveGenerationSchema = z.object({
  url: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().max(4000).optional(),
  generationId: z.string().optional(),
  tags: z.string().trim().max(200).optional(),
});

export async function saveGeneratedImageAction(input: z.infer<typeof saveGenerationSchema>) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = saveGenerationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "参数错误" };

  let stored: Awaited<ReturnType<typeof saveImageFromUrl>> | null = null;
  try {
    await assertControlledModuleAvailableForUser("library", session.user.id);
    stored = await saveImageFromUrl(parsed.data.url, session.user.id);
    await prisma.material.create({
      data: {
        ownerId: session.user.id,
        ownerType: "USER",
        type: "IMAGE",
        source: "GENERATION",
        visibility: "PRIVATE",
        status: "DRAFT",
        title: parsed.data.title,
        description: parsed.data.prompt || null,
        tags: tagsToJson(parsed.data.tags),
        url: stored.url,
        storageKey: stored.storageKey,
        thumbnailUrl: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sourceGenerationId: parsed.data.generationId || null,
      },
    });
  } catch (e) {
    await deleteStoredMaterialFile(stored?.storageKey ?? null);
    return { error: e instanceof Error ? e.message : "保存失败" };
  }

  revalidatePath("/library");
  return { ok: true };
}

export async function deleteMaterialAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: {
      ownerId: true,
      storageKey: true,
      url: true,
      thumbnailUrl: true,
    },
  });
  if (!material || material.ownerId !== session.user.id) {
    return { error: "素材不存在" };
  }
  const storageKey =
    material.storageKey ??
    materialStorageKeyFromUrl(material.url) ??
    materialStorageKeyFromUrl(material.thumbnailUrl ?? "");
  await prisma.material.delete({ where: { id: materialId } });
  await deleteUnreferencedMaterialFile(storageKey);
  revalidatePath("/library");
  revalidatePath("/materials");
  return { ok: true };
}

export async function requestMaterialReviewAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: {
      ownerId: true,
      visibility: true,
      status: true,
      type: true,
      title: true,
      description: true,
      tags: true,
      promptText: true,
      mimeType: true,
      sizeBytes: true,
    },
  });
  if (!material || material.ownerId !== session.user.id) return { error: "素材不存在" };
  if (material.status === "PENDING_REVIEW") return { error: "素材已在审核中" };
  if (material.visibility === "PUBLIC" && material.status === "APPROVED") {
    return { error: "素材已公开" };
  }

  const submission = await resolveMaterialSubmissionState("PUBLIC", {
    type: material.type,
    title: material.title,
    description: material.description,
    tags: material.tags,
    promptText: material.promptText,
    mimeType: material.mimeType,
    sizeBytes: material.sizeBytes,
  });

  await prisma.material.update({
    where: { id: materialId },
    data: submission,
  });

  revalidatePath("/library");
  revalidatePath("/admin/materials");
  revalidatePath("/materials");
  return { ok: true, status: submission.status };
}

export async function makeMaterialPrivateAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { ownerId: true },
  });
  if (!material || material.ownerId !== session.user.id) return { error: "素材不存在" };

  await prisma.material.update({
    where: { id: materialId },
    data: { visibility: "PRIVATE", status: "DRAFT" },
  });

  revalidatePath("/library");
  revalidatePath("/materials");
  return { ok: true };
}

export async function toggleFavoriteMaterialAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      visibility: "PUBLIC",
      status: "APPROVED",
    },
    select: { id: true },
  });
  if (!material) return { error: "素材不存在" };

  const existing = await prisma.materialFavorite.findUnique({
    where: { userId_materialId: { userId: session.user.id, materialId } },
  });
  if (existing) {
    await prisma.materialFavorite.delete({ where: { id: existing.id } });
  } else {
    await prisma.materialFavorite.create({ data: { userId: session.user.id, materialId } });
  }

  revalidatePath("/materials");
  revalidatePath("/library");
  revalidatePath(`/materials/${materialId}`);
  return { ok: true, favorited: !existing };
}

export async function toggleLikeMaterialAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      visibility: "PUBLIC",
      status: "APPROVED",
    },
    select: { id: true },
  });
  if (!material) return { error: "素材不存在" };

  const existing = await prisma.materialLike.findUnique({
    where: { userId_materialId: { userId: session.user.id, materialId } },
  });
  if (existing) {
    await prisma.materialLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.materialLike.create({ data: { userId: session.user.id, materialId } });
  }

  revalidatePath("/materials");
  revalidatePath(`/materials/${materialId}`);
  return { ok: true, liked: !existing };
}

export async function reportMaterialAction(materialId: string, reason: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }
  const parsed = z.object({
    materialId: z.string().min(1).max(100),
    reason: z.string().trim().min(1, "请填写举报原因").max(200, "举报原因不能超过 200 字"),
  }).safeParse({ materialId, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "参数错误" };
  }

  const limited = await enforceUserRequestLimit(
    session.user.id,
    REQUEST_LIMITS.materialReport,
  );
  if (limited) return { error: REQUEST_LIMITS.materialReport.message };

  const result = await createMaterialReport({
    materialId: parsed.data.materialId,
    reporterId: session.user.id,
    reason: parsed.data.reason,
  });
  if (result === "not-found") return { error: "素材不存在" };
  if (result === "own-material") return { error: "不能举报自己的素材" };
  if (result === "already-reported") return { error: "该举报正在处理中" };

  revalidatePath("/admin/materials");
  return { ok: true };
}

export async function saveImageMaterialCopyAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      type: "IMAGE",
      visibility: "PUBLIC",
      status: "APPROVED",
    },
    select: {
      title: true,
      description: true,
      tags: true,
      url: true,
      storageKey: true,
      sourceGenerationId: true,
    },
  });
  if (!material?.url) return { error: "素材不存在" };

  let stored: Awaited<ReturnType<typeof saveImageFromUrl>> | null = null;
  try {
    stored = await saveImageFromUrl(material.url, session.user.id, {
      allowedLocalStorageKey:
        material.storageKey ?? materialStorageKeyFromUrl(material.url),
    });
    await prisma.material.create({
      data: {
        ownerId: session.user.id,
        ownerType: "USER",
        type: "IMAGE",
        source: "REFERENCE",
        visibility: "PRIVATE",
        status: "DRAFT",
        title: material.title,
        description: material.description,
        tags: material.tags,
        url: stored.url,
        storageKey: stored.storageKey,
        thumbnailUrl: stored.url,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sourceGenerationId: material.sourceGenerationId,
      },
    });
  } catch (e) {
    await deleteStoredMaterialFile(stored?.storageKey ?? null);
    return { error: e instanceof Error ? e.message : "保存失败" };
  }

  revalidatePath("/library");
  revalidatePath(`/materials/${materialId}`);
  return { ok: true };
}

export async function savePromptMaterialCopyAction(materialId: string) {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };
  try {
    await assertControlledModuleAvailableForUser("materials", session.user.id);
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "操作已暂停" };
  }

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      type: "PROMPT",
      visibility: "PUBLIC",
      status: "APPROVED",
    },
    select: {
      title: true,
      description: true,
      tags: true,
      storageKey: true,
      thumbnailUrl: true,
      promptText: true,
      promptMeta: true,
      mimeType: true,
      sizeBytes: true,
    },
  });
  if (!material?.promptText) return { error: "提示词不存在" };

  let cover: Awaited<ReturnType<typeof saveImageFromUrl>> | null = null;
  try {
    if (material.thumbnailUrl) {
      cover = await saveImageFromUrl(material.thumbnailUrl, session.user.id, {
        namePrefix: "prompt-cover",
        allowedLocalStorageKey:
          materialStorageKeyFromUrl(material.thumbnailUrl) ??
          material.storageKey,
      });
    }
    await prisma.material.create({
      data: {
        ownerId: session.user.id,
        ownerType: "USER",
        type: "PROMPT",
        source: "REFERENCE",
        visibility: "PRIVATE",
        status: "DRAFT",
        title: material.title,
        description: material.description,
        tags: material.tags,
        url: "",
        storageKey: cover?.storageKey,
        thumbnailUrl: cover?.url,
        promptText: material.promptText,
        promptMeta: material.promptMeta,
        mimeType: cover?.mimeType || material.mimeType || "text/plain",
        sizeBytes: cover?.sizeBytes ?? material.sizeBytes,
      },
    });
  } catch (error) {
    await deleteStoredMaterialFile(cover?.storageKey ?? null);
    return {
      error: error instanceof Error ? error.message : "提示词保存失败",
    };
  }

  revalidatePath("/library");
  revalidatePath(`/materials/${materialId}`);
  return { ok: true };
}
