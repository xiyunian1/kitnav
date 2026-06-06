import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTurnSchema } from "@/lib/image-schema";
import { runImageTurn, TurnError, type ImageTurnProgressEvent } from "@/lib/image-workbench";

export const runtime = "nodejs";

function encodeEvent(event: ImageTurnProgressEvent) {
  return `${JSON.stringify(event)}\n`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const parsed = generateTurnSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        await runImageTurn({
          userId,
          conversationId: parsed.data.conversationId,
          prompt: parsed.data.prompt,
          ratio: parsed.data.ratio,
          quality: parsed.data.quality,
          count: parsed.data.count,
          model: parsed.data.model,
          mode: "generate",
          onProgress: (event) => {
            controller.enqueue(encoder.encode(encodeEvent(event)));
          },
        });
      } catch (e) {
        const status = e instanceof TurnError ? e.status : 500;
        const message = e instanceof Error ? e.message : "生成失败";
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", status, error: message })}\n`));
      } finally {
        controller.close();
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
