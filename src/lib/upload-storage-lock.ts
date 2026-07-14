import { prisma } from "@/lib/db";
import type { UploadStorageKind } from "@/lib/upload-storage";

type UploadStorageLockKind = UploadStorageKind | "ppt";

export async function withUploadStorageLock<T>(
	kind: UploadStorageLockKind,
  ownerId: string,
  callback: () => Promise<T>,
) {
  const lockName = `upload-storage:${kind}:${ownerId}`;
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`;
      return callback();
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
}
