import { PrismaClient } from "@prisma/client";
import { saveImageFromUrl } from "../src/lib/materials";

const prisma = new PrismaClient();

type StoredTurnImage = {
  id: string;
  status: "queued" | "loading" | "success" | "error";
  url?: string;
  error?: string;
};

function parseImages(value: string | null): StoredTurnImage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function main() {
  const turns = await prisma.imageTurn.findMany({
    where: { images: { contains: "data:image/" } },
    select: {
      id: true,
      conversationId: true,
      images: true,
      conversation: { select: { userId: true } },
    },
  });

  let converted = 0;
  for (const turn of turns) {
    const images = parseImages(turn.images);
    let changed = false;
    const nextImages: StoredTurnImage[] = [];

    for (const image of images) {
      if (image.status === "success" && image.url?.startsWith("data:image/")) {
        const stored = await saveImageFromUrl(
          image.url,
          `${turn.conversation.userId}-${turn.id}-${image.id || converted}`
        );
        nextImages.push({ ...image, url: stored.url });
        changed = true;
        converted += 1;
      } else {
        nextImages.push(image);
      }
    }

    if (changed) {
      await prisma.imageTurn.update({
        where: { id: turn.id },
        data: { images: JSON.stringify(nextImages) },
      });
      console.log(`Compacted ${turn.id}`);
    }
  }

  console.log(`Converted ${converted} embedded image(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
