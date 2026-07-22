import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { editTurnFieldsSchema } from "@/lib/image-schema";
import { enqueueImageTurn, TurnError } from "@/lib/image-workbench";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
  parseReferenceImageUploads,
  ReferenceImageRequestError,
} from "@/lib/image-edit-request";

export const runtime = "nodejs";

// POST /api/image/turns/edit  图生图（multipart/form-data）
// 字段：conversationId? / prompt / ratio / count / images(重复文件字段)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const limited = await enforceUserRequestLimit(
    userId,
    REQUEST_LIMITS.imageGenerate,
  );
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  let images: ReturnType<typeof parseReferenceImageUploads>;
  try {
    images = parseReferenceImageUploads(form);
  } catch (error) {
    if (error instanceof ReferenceImageRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const parsed = editTurnFieldsSchema.safeParse({
    conversationId: form.get("conversationId") || undefined,
    prompt: form.get("prompt") || "",
    ratio: form.get("ratio") || "1:1",
    quality: form.get("quality") || "standard",
    count: form.get("count") || "1",
    model: form.get("model") || undefined,
    modelSource: form.get("modelSource") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  const { conversationId, prompt, ratio, quality, count, model, modelSource } = parsed.data;

  try {
    const turn = await enqueueImageTurn({
      userId,
      conversationId,
      prompt,
      ratio,
      quality,
      count,
      model,
      modelSource,
      mode: "edit",
      editImages: images,
    });
    return NextResponse.json({ turn, conversationId: turn.conversationId });
  } catch (e) {
    if (e instanceof TurnError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "生成失败";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
