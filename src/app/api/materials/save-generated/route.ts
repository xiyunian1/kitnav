import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { saveImageFromUrl, tagsToJson } from "@/lib/materials";

export const runtime = "nodejs";

const schema = z.object({
  url: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().max(4000).optional(),
  generationId: z.string().optional(),
  tags: z.string().trim().max(200).optional(),
  meta: z
    .object({
      mode: z.enum(["generate", "edit"]).optional(),
      ratio: z.string().trim().max(20).optional(),
      quality: z.string().trim().max(20).optional(),
      count: z.number().int().min(1).max(10).optional(),
      model: z.string().trim().max(120).optional(),
      durationMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  try {
    const stored = await saveImageFromUrl(parsed.data.url, session.user.id);
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
        promptText: parsed.data.prompt || null,
        promptMeta: parsed.data.meta ? JSON.stringify(parsed.data.meta) : null,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sourceGenerationId: parsed.data.generationId || null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
