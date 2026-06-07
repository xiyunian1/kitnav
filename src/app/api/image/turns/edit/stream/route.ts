import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { editTurnFieldsSchema } from "@/lib/image-schema";
import { runImageTurn, TurnError, type ImageTurnProgressEvent } from "@/lib/image-workbench";

export const runtime = "nodejs";

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

  const filename = image instanceof File && image.name ? image.name : "reference.png";
  const thumb = form.get("referenceThumb");
  const referenceThumbs =
    typeof thumb === "string" && thumb.startsWith("data:") ? [thumb] : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const enqueue = (event: ImageTurnProgressEvent | { type: "error"; status: number; error: string }) => {
        if (closed || req.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await runImageTurn({
          userId,
          conversationId: parsed.data.conversationId,
          prompt: parsed.data.prompt,
          ratio: parsed.data.ratio,
          quality: parsed.data.quality,
          count: parsed.data.count,
          model: parsed.data.model,
          mode: "edit",
          editImage: { blob: image, filename },
          referenceThumbs,
          signal: req.signal,
          onProgress: (event) => {
            enqueue(event);
          },
        });
      } catch (e) {
        const status = e instanceof TurnError ? e.status : 500;
        const message = e instanceof Error ? e.message : "生成失败";
        enqueue({ type: "error", status, error: message });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            closed = true;
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
