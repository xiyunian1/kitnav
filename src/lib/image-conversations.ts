import { prisma } from "@/lib/db";
import {
  encodeImageConversationCursor,
  type ImageConversationCursor,
} from "@/lib/image-conversation-pagination";

export async function listImageConversationsPage(input: {
  userId: string;
  query?: string;
  take: number;
  cursor?: ImageConversationCursor | null;
}) {
  const rows = await prisma.imageConversation.findMany({
    where: {
      userId: input.userId,
      ...(input.query ? { title: { contains: input.query } } : {}),
      ...(input.cursor
        ? {
            OR: [
              { updatedAt: { lt: input.cursor.updatedAt } },
              {
                updatedAt: input.cursor.updatedAt,
                id: { lt: input.cursor.id },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { turns: true } },
    },
    take: input.take + 1,
  });
  const hasMore = rows.length > input.take;
  const page = rows.slice(0, input.take);
  const last = page.at(-1);

  return {
    conversations: page.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      turnCount: conversation._count.turns,
    })),
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeImageConversationCursor({
            updatedAt: last.updatedAt,
            id: last.id,
          })
        : null,
  };
}
