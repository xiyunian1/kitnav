import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.QUEUE_CAPACITY_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("QUEUE_CAPACITY_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_test")) {
  throw new Error("Integration database name must end with _test");
}

process.env.DATABASE_URL = databaseUrl;

async function main() {
  const { prisma } = await import("@/lib/db");
  const { checkImageQueueCapacity, checkPptQueueCapacity } = await import(
    "@/lib/queue-capacity"
  );
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `queue-capacity-${suffix}`;
  const conversationId = `queue-capacity-conversation-${suffix}`;
  const imageSlots = 3;
  const pptSlots = 2;

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@integration.test`,
        imageConversations: {
          create: { id: conversationId, title: "Queue capacity" },
        },
      },
    });

    const initialImagePending = await prisma.imageTurn.count({
      where: { status: "PENDING" },
    });
    const initialPptPending = await prisma.pptProject.count({
      where: {
        status: {
          in: [
            "PENDING",
            "QUEUED",
            "GENERATING",
            "STRATEGIZING",
            "ACQUIRING_IMAGES",
            "EXECUTING",
            "EXPORTING",
          ],
        },
      },
    });
    assert(initialImagePending + imageSlots <= 10_000);
    assert(initialPptPending + pptSlots <= 1_000);
    process.env.IMAGE_GLOBAL_MAX_PENDING = String(
      initialImagePending + imageSlots,
    );
    process.env.PPT_GLOBAL_MAX_PENDING = String(initialPptPending + pptSlots);

    const imageResults = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        prisma.$transaction(
          async (tx) => {
            const capacity = await checkImageQueueCapacity(tx);
            if (!capacity.allowed) return false;
            await tx.imageTurn.create({
              data: {
                conversationId,
                prompt: `Capacity image ${index}`,
                mode: "generate",
                model: "integration-model",
                ratio: "1:1",
                pixelSize: "1024x1024",
                count: 1,
                status: "PENDING",
              },
            });
            return true;
          },
          { maxWait: 15_000, timeout: 15_000 },
        ),
      ),
    );
    assert.equal(imageResults.filter(Boolean).length, imageSlots);

    const pptResults = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        prisma.$transaction(
          async (tx) => {
            const capacity = await checkPptQueueCapacity(tx);
            if (!capacity.allowed) return false;
            await tx.pptProject.create({
              data: {
                userId,
                title: `Capacity PPT ${index}`,
                sourceType: "TOPIC",
                status: "QUEUED",
              },
            });
            return true;
          },
          { maxWait: 15_000, timeout: 15_000 },
        ),
      ),
    );
    assert.equal(pptResults.filter(Boolean).length, pptSlots);

    console.log("Global queue capacity integration check passed.");
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
