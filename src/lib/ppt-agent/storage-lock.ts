import type { Prisma } from "@prisma/client";

export const PPT_STORAGE_SWEEP_LOCK_NAME = "ppt-storage-sweep";

export async function tryAcquirePptStorageReferenceLock(
  tx: Prisma.TransactionClient,
) {
  const [result] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock_shared(
      hashtextextended(${PPT_STORAGE_SWEEP_LOCK_NAME}, 0)
    ) AS locked
  `;
  return Boolean(result?.locked);
}

export async function tryAcquirePptStorageSweepLock(
  tx: Prisma.TransactionClient,
) {
  const [result] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(
      hashtextextended(${PPT_STORAGE_SWEEP_LOCK_NAME}, 0)
    ) AS locked
  `;
  return Boolean(result?.locked);
}
