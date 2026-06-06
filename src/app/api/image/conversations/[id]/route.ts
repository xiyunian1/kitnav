import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { renameConversationSchema } from "@/lib/image-schema";
import { serializeTurn } from "@/lib/image-workbench";

// 校验会话归属，返回匹配的会话或 null
async function getOwnedConversation(userId: string, id: string) {
  const conv = await prisma.imageConversation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!conv || conv.userId !== userId) return null;
  return conv;
}

const DEFAULT_TAKE = 8;
const MAX_TAKE = 20;

function parseTake(value: string | null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TAKE;
  return Math.min(MAX_TAKE, Math.max(1, Math.floor(n)));
}

function parseBefore(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// GET 会话详情（默认只返回最近 turns，before 分页加载更早记录）
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const searchParams = new URL(req.url).searchParams;
  const take = parseTake(searchParams.get("take"));
  const before = parseBefore(searchParams.get("before"));

  const conv = await prisma.imageConversation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { turns: true } },
      turns: {
        where: before ? { createdAt: { lt: before } } : undefined,
        orderBy: { createdAt: "desc" },
        take: take + 1,
      },
    },
  });
  if (!conv || conv.userId !== session.user.id) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  const hasMore = conv.turns.length > take;
  const pageTurns = conv.turns.slice(0, take).reverse();

  return NextResponse.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      turns: pageTurns.map(serializeTurn),
      totalTurns: conv._count.turns,
      hasMore,
      nextBefore: hasMore && pageTurns.length > 0 ? pageTurns[0].createdAt.toISOString() : null,
    },
  });
}

// PATCH 重命名
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await getOwnedConversation(session.user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const parsed = renameConversationSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  await prisma.imageConversation.update({
    where: { id },
    data: { title: parsed.data.title },
  });
  return NextResponse.json({ ok: true });
}

// DELETE 删除会话（级联删 turns）
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const owned = await getOwnedConversation(session.user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }
  await prisma.imageConversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
