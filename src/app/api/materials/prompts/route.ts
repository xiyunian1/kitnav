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

export const runtime = "nodejs";

const promptMetaSchema = z.object({
  mode: z.enum(["generate", "edit"]).default("generate"),
  ratio: z.string().optional(),
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

  const material = await prisma.material.create({
    data: {
      ownerId: session.user.id,
      ownerType: "USER",
      type: "PROMPT",
      source: "UPLOAD",
      visibility: parsed.data.visibility,
      status: parsed.data.visibility === "PUBLIC" ? "PENDING_REVIEW" : "DRAFT",
      title: parsed.data.title,
      description: parsed.data.description || null,
      tags: tagsToJson(parsed.data.tags),
      url: "",
      storageKey: cover?.storageKey,
      thumbnailUrl: cover?.url,
      promptText: parsed.data.promptText,
      promptMeta: parsed.data.meta ? JSON.stringify(parsed.data.meta) : null,
      mimeType: cover?.mimeType || "text/plain",
      sizeBytes: cover?.sizeBytes,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, id: material.id });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
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

  await prisma.material.update({
    where: { id: parsed.data.id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      tags: tagsToJson(parsed.data.tags),
      visibility: parsed.data.visibility,
      status: parsed.data.visibility === "PUBLIC" ? "PENDING_REVIEW" : "DRAFT",
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
  });
  if (cover) await deleteStoredMaterialFile(existing.storageKey);

  return NextResponse.json({ ok: true, id: parsed.data.id });
}
