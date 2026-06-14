import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteStoredMaterialFile,
  saveImageBlob,
  serializeMaterial,
  tagsToJson,
} from "@/lib/materials";
import { resolveMaterialSubmissionState } from "@/lib/material-review";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";

export const runtime = "nodejs";

const promptMetaSchema = z.object({
  module: z.enum(["IMAGE", "PPT"]).default("IMAGE"),
  kind: z.string().trim().max(40).optional(),
  mode: z.enum(["generate", "edit"]).default("generate"),
  ratio: z.string().optional(),
  quality: z.string().optional(),
  count: z.number().int().min(1).max(10).optional(),
  model: z.string().trim().max(120).optional(),
});

const createPromptSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
  promptText: z.string().trim().min(1).max(4000),
  tags: z.string().trim().max(200).optional(),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
  meta: promptMetaSchema.optional(),
});

async function readPromptInput(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const image = form.get("referenceImage");
    return {
      raw: {
        id: form.get("id") || undefined,
        title: form.get("title") || "",
        description: form.get("description") || undefined,
        promptText: form.get("promptText") || "",
        tags: form.get("tags") || undefined,
        visibility: form.get("visibility") || "PRIVATE",
        meta: {
          module: form.get("module") || "IMAGE",
          kind: form.get("kind") || undefined,
          mode: form.get("mode") || "generate",
          ratio: form.get("ratio") || undefined,
          count: form.get("count") ? Number(form.get("count")) : undefined,
          model: form.get("model") || undefined,
        },
      },
      image: image instanceof Blob && image.size > 0 ? image : null,
    };
  }

  const raw = await req.json();
  return { raw, image: null };
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const scope = params.get("scope") === "square" ? "square" : "mine";
  const q = params.get("q")?.trim() || "";
  try {
    await assertControlledModuleAvailableForUser(
      scope === "square" ? "materials" : "library",
      session.user.id
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材模块已暂停" },
      { status: 503 }
    );
  }

  const materials = await prisma.material.findMany({
    where: {
      type: "PROMPT",
      ...(scope === "square"
        ? {
            visibility: "PUBLIC",
            status: "APPROVED",
          }
        : {
            OR: [
              { ownerId: session.user.id },
              {
                visibility: "PUBLIC",
                status: "APPROVED",
                favorites: { some: { userId: session.user.id } },
              },
            ],
          }),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: q } },
                  { description: { contains: q } },
                  { promptText: { contains: q } },
                  { tags: { contains: q } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId: session.user.id } },
      likes: { where: { userId: session.user.id } },
      _count: { select: { favorites: true, likes: true } },
    },
  });

  return NextResponse.json({
    materials: materials.map((material) => serializeMaterial(material, session.user.id)),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  try {
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材库已暂停" },
      { status: 503 }
    );
  }

  let input: Awaited<ReturnType<typeof readPromptInput>>;
  try {
    input = await readPromptInput(req);
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = createPromptSchema.safeParse(input.raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  let cover:
    | { url: string; storageKey: string; mimeType: string; sizeBytes: number }
    | null = null;
  if (input.image) {
    try {
      cover = await saveImageBlob(input.image, session.user.id);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "参考图上传失败" },
        { status: 400 }
      );
    }
  }

  const submission = await resolveMaterialSubmissionState(parsed.data.visibility, {
    type: "PROMPT",
    title: parsed.data.title,
    description: parsed.data.description,
    tags: normalizePromptTags(parsed.data.tags, parsed.data.meta),
    promptText: parsed.data.promptText,
    mimeType: cover?.mimeType || "text/plain",
    sizeBytes: cover?.sizeBytes,
  });

  const material = await prisma.material.create({
    data: {
      ownerId: session.user.id,
      ownerType: "USER",
      type: "PROMPT",
      source: "UPLOAD",
      visibility: submission.visibility,
      status: submission.status,
      rejectionReason: submission.rejectionReason,
      reviewedAt: submission.reviewedAt,
      title: parsed.data.title,
      description: parsed.data.description || null,
      tags: tagsToJson(normalizePromptTags(parsed.data.tags, parsed.data.meta)),
      url: "",
      storageKey: cover?.storageKey,
      thumbnailUrl: cover?.url,
      promptText: parsed.data.promptText,
      promptMeta: parsed.data.meta ? JSON.stringify(parsed.data.meta) : null,
      mimeType: cover?.mimeType || "text/plain",
      sizeBytes: cover?.sizeBytes,
    },
    select: { id: true, status: true },
  });

  return NextResponse.json({ ok: true, id: material.id, status: material.status });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  try {
    await assertControlledModuleAvailableForUser("library", session.user.id);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "素材库已暂停" },
      { status: 503 }
    );
  }

  let input: Awaited<ReturnType<typeof readPromptInput>>;
  try {
    input = await readPromptInput(req);
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = createPromptSchema.extend({ id: z.string().min(1) }).safeParse(input.raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  if (parsed.data.visibility === "PUBLIC") {
    try {
      await assertControlledModuleAvailableForUser("materials", session.user.id);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "素材广场已暂停" },
        { status: 503 }
      );
    }
  }

  const existing = await prisma.material.findUnique({
    where: { id: parsed.data.id },
    select: { ownerId: true, type: true, storageKey: true },
  });
  if (!existing || existing.ownerId !== session.user.id || existing.type !== "PROMPT") {
    return NextResponse.json({ error: "提示词不存在" }, { status: 404 });
  }

  let cover:
    | { url: string; storageKey: string; mimeType: string; sizeBytes: number }
    | null = null;
  if (input.image) {
    try {
      cover = await saveImageBlob(input.image, session.user.id);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "参考图上传失败" },
        { status: 400 }
      );
    }
  }

  const submission = await resolveMaterialSubmissionState(parsed.data.visibility, {
    type: "PROMPT",
    title: parsed.data.title,
    description: parsed.data.description,
    tags: normalizePromptTags(parsed.data.tags, parsed.data.meta),
    promptText: parsed.data.promptText,
    mimeType: cover?.mimeType || "text/plain",
    sizeBytes: cover?.sizeBytes,
  });

  const updated = await prisma.material.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      tags: tagsToJson(normalizePromptTags(parsed.data.tags, parsed.data.meta)),
      visibility: submission.visibility,
      status: submission.status,
      rejectionReason: submission.rejectionReason,
      reviewedAt: submission.reviewedAt,
      promptText: parsed.data.promptText,
      promptMeta: parsed.data.meta ? JSON.stringify(parsed.data.meta) : null,
      ...(cover
        ? {
            storageKey: cover.storageKey,
            thumbnailUrl: cover.url,
            mimeType: cover.mimeType,
            sizeBytes: cover.sizeBytes,
          }
        : {}),
    },
    select: { id: true, status: true },
  });
  if (cover) await deleteStoredMaterialFile(existing.storageKey);

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status });
}

function normalizePromptTags(
  tags: string | undefined,
  meta?: z.infer<typeof promptMetaSchema>
) {
  if (meta?.module !== "PPT") return tags;
  const base = tags?.trim() || "";
  const required = ["PPT风格", "ppt-style"];
  const text = `${base} ${required.join(" ")}`.trim();
  return text;
}
