import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cancelImageTurn, TurnError } from "@/lib/image-workbench";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const turn = await cancelImageTurn(session.user.id, id);
    return NextResponse.json({ turn });
  } catch (e) {
    if (e instanceof TurnError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "停止生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
