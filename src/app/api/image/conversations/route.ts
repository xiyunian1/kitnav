import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/image/conversations?q=  列出当前用户会话（按 updatedAt desc，可搜索标题）
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const q = new URL(req.url).searchParams.get("q")?.trim() || "";

  const conversations = await prisma.imageConversation.findMany({
    where: {
      userId,
      ...(q ? { title: { contains: q } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { turns: true } },
    },
    take: 100,
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      turnCount: c._count.turns,
    })),
  });
}

// POST /api/image/conversations  新建空会话
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const created = await prisma.imageConversation.create({
    data: { userId: session.user.id, title: "新会话" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({
    conversation: {
      id: created.id,
      title: created.title,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      turnCount: 0,
    },
  });
}

// DELETE /api/image/conversations?all=1  清空当前用户所有会话
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const all = new URL(req.url).searchParams.get("all");
  if (all !== "1") {
    return NextResponse.json({ error: "缺少 all=1 参数" }, { status: 400 });
  }
  await prisma.imageConversation.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
