import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteStoredMaterialUrl } from "@/lib/materials";
import {
  decodeImageConversationCursor,
  parseImageConversationPageSize,
} from "@/lib/image-conversation-pagination";
import { listImageConversationsPage } from "@/lib/image-conversations";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";

// GET /api/image/conversations?q=  列出当前用户会话（按 updatedAt desc，可搜索标题）
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const searchParams = new URL(req.url).searchParams;
  const q = searchParams.get("q")?.trim().slice(0, 100) || "";
  const take = parseImageConversationPageSize(searchParams.get("take"));
  let cursor;
  try {
    cursor = decodeImageConversationCursor(searchParams.get("cursor"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "会话分页游标无效" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const page = await listImageConversationsPage({
    userId,
    query: q,
    take,
    cursor,
  });

  return NextResponse.json(
    page,
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST /api/image/conversations  新建空会话
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const limited = await enforceUserRequestLimit(
    session.user.id,
    REQUEST_LIMITS.imageConversationWrite,
  );
  if (limited) return limited;
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
  const limited = await enforceUserRequestLimit(
    session.user.id,
    REQUEST_LIMITS.imageConversationWrite,
  );
  if (limited) return limited;
  const all = new URL(req.url).searchParams.get("all");
  if (all !== "1") {
    return NextResponse.json({ error: "缺少 all=1 参数" }, { status: 400 });
  }
  const pending = await prisma.imageTurn.count({
    where: { status: "PENDING", conversation: { userId: session.user.id } },
  });
  if (pending > 0) {
    return NextResponse.json(
      { error: "请先停止正在等待或生成的图片任务" },
      { status: 409 },
    );
  }
  const turns = await prisma.imageTurn.findMany({
    where: { conversation: { userId: session.user.id } },
    select: { images: true },
  });
  await prisma.imageConversation.deleteMany({ where: { userId: session.user.id } });
  const urls = new Set<string>();
  for (const turn of turns) {
    if (!turn.images) continue;
    try {
      const images = JSON.parse(turn.images) as Array<{ url?: unknown }>;
      if (!Array.isArray(images)) continue;
      for (const image of images) {
        if (typeof image?.url === "string") urls.add(image.url);
      }
    } catch {
      // Ignore corrupt historical result JSON while clearing conversations.
    }
  }
  for (const url of urls) await deleteStoredMaterialUrl(url);
  return NextResponse.json({ ok: true });
}
