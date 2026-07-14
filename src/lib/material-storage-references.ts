import { prisma } from "@/lib/db";
import {
  deleteStoredUploadFile,
  parseUploadStorageKey,
} from "@/lib/upload-storage";

function referenceFilter(storageKey: string) {
  const suffix = `/${storageKey}`;
  return [
    { storageKey },
    { url: { endsWith: suffix } },
    { thumbnailUrl: { endsWith: suffix } },
  ];
}

function isValidStorageKey(storageKey: string) {
  try {
    parseUploadStorageKey(storageKey);
    return true;
  } catch {
    return false;
  }
}

export async function isMaterialStorageKeyReferencedByUser(
  storageKey: string,
  userId: string,
) {
  if (!isValidStorageKey(storageKey)) return false;
  const row = await prisma.material.findFirst({
    where: {
      ownerId: userId,
      OR: referenceFilter(storageKey),
    },
    select: { id: true },
  });
  return Boolean(row);
}

export async function deleteUnreferencedMaterialFile(
  storageKey: string | null,
) {
  if (!storageKey || !isValidStorageKey(storageKey)) return false;
  const reference = await prisma.material.findFirst({
    where: { OR: referenceFilter(storageKey) },
    select: { id: true },
  });
  if (reference) return false;
  await deleteStoredUploadFile("materials", storageKey);
  return true;
}
