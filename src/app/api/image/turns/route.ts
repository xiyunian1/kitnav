import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTurnSchema } from "@/lib/image-schema";
import { runImageTurn, TurnError } from "@/lib/image-workbench";

// POST /api/image/turns  文生图（JSON）
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
  const { conversationId, prompt, ratio, quality, count, model, modelSource } = parsed.data;

  try {
    const turn = await runImageTurn({
      userId,
      conversationId,
      prompt,
      ratio,
      quality,
      count,
      model,
      modelSource,
      mode: "generate",
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
