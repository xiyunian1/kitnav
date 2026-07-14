import assert from "node:assert/strict";

const databaseUrl = process.env.IMAGE_CONVERSATION_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("IMAGE_CONVERSATION_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_image_conversation_test")) {
  throw new Error(
    "Integration database name must end with _image_conversation_test",
  );
}

process.env.DATABASE_URL = databaseUrl;

async function main() {
  const { prisma } = await import("@/lib/db");
  const { decodeImageConversationCursor } = await import(
    "@/lib/image-conversation-pagination"
  );
  const { listImageConversationsPage } = await import(
    "@/lib/image-conversations"
  );
  const userId = "image-conversation-integration-user";

  try {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: {
        id: userId,
        email: "image-conversation-integration@example.com",
      },
    });
    const created = Array.from({ length: 125 }, (_, index) => ({
      id: `conversation-${String(index).padStart(3, "0")}`,
      userId,
      title: index % 11 === 0 ? `special-${index}` : `conversation-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, Math.floor(index / 5))),
    }));
    await prisma.imageConversation.createMany({ data: created });

    const expected = [...created]
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.id.localeCompare(left.id, "en"),
      )
      .map((item) => item.id);
    const actual: string[] = [];
    let cursor: ReturnType<typeof decodeImageConversationCursor> = null;
    do {
      const page = await listImageConversationsPage({
        userId,
        take: 17,
        cursor,
      });
      actual.push(...page.conversations.map((item) => item.id));
      cursor = decodeImageConversationCursor(page.nextCursor);
      if (!page.hasMore) assert.equal(page.nextCursor, null);
    } while (cursor);
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, created.length);

    const search = await listImageConversationsPage({
      userId,
      query: "special-",
      take: 100,
    });
    assert.equal(search.hasMore, false);
    assert.equal(search.conversations.length, 12);
    assert(search.conversations.every((item) => item.title.startsWith("special-")));

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'ImageConversation'
    `;
    assert(
      indexes.some(
        (index) =>
          index.indexname === "ImageConversation_userId_updatedAt_id_idx",
      ),
    );
    console.log("Image conversation pagination integration check passed.");
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
