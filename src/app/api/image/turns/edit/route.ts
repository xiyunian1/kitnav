import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { editTurnFieldsSchema } from "@/lib/image-schema";
import { runImageTurn, TurnError } from "@/lib/image-workbench";

export const runtime = "nodejs";

// POST /api/image/turns/edit  图生图（multipart/form-data）
// 字段：conversationId? / prompt / ratio / count / image(文件) / referenceThumb?(缩略 data URL)
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const image = form.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return NextResponse.json({ error: "请上传参考图" }, { status: 400 });
  }

  const parsed = editTurnFieldsSchema.safeParse({
    conversationId: form.get("conversationId") || undefined,
    prompt: form.get("prompt") || "",
    ratio: form.get("ratio") || "1:1",
    quality: form.get("quality") || "standard",
    count: form.get("count") || "1",
    model: form.get("model") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }
  const { conversationId, prompt, ratio, quality, count, model } = parsed.data;

  const filename = image instanceof File && image.name ? image.name : "reference.png";
  const thumb = form.get("referenceThumb");
  const referenceThumbs =
    typeof thumb === "string" && thumb.startsWith("data:") ? [thumb] : undefined;

  try {
    const turn = await runImageTurn({
      userId,
      conversationId,
      prompt,
      ratio,
      quality,
      count,
      model,
      mode: "edit",
      editImage: { blob: image, filename },
      referenceThumbs,
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
