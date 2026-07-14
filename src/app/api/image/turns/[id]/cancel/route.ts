import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelImageTurn, TurnError } from "@/lib/image-workbench";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const limited = await enforceUserRequestLimit(
    session.user.id,
    REQUEST_LIMITS.imageCancel,
  );
  if (limited) return limited;

  const { id } = await params;
  try {
    const turn = await cancelImageTurn(session.user.id, id);
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { credits: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: "登录已失效，请重新登录" },
        { status: 401 },
      );
    }
    return NextResponse.json({ turn, balance: user.credits });
  } catch (e) {
    if (e instanceof TurnError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "停止生成失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
