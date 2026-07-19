import type { Prisma } from "@prisma/client";
import { boundedIntegerEnv } from "@/lib/runtime-config";
import { PPT_CAPACITY_STATUSES } from "@/lib/ppt-agent/status";

const IMAGE_QUEUE_CAPACITY_LOCK = "queue-capacity:image";
const PPT_QUEUE_CAPACITY_LOCK = "queue-capacity:ppt";

type Environment = Readonly<Record<string, string | undefined>>;

export function getImageGlobalMaxPending(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("IMAGE_GLOBAL_MAX_PENDING", 100, {
    min: 1,
    max: 10_000,
    environment,
  });
}

export function getPptGlobalMaxPending(
  environment: Environment = process.env,
) {
  return boundedIntegerEnv("PPT_GLOBAL_MAX_PENDING", 30, {
    min: 1,
    max: 1_000,
    environment,
  });
}

export async function checkImageQueueCapacity(
  tx: Prisma.TransactionClient,
  environment: Environment = process.env,
) {
  await acquireCapacityLock(tx, IMAGE_QUEUE_CAPACITY_LOCK);
  const maxPending = getImageGlobalMaxPending(environment);
  const pending = await tx.imageTurn.count({ where: { status: "PENDING" } });
  return { allowed: pending < maxPending, pending, maxPending };
}

export async function checkPptQueueCapacity(
  tx: Prisma.TransactionClient,
  environment: Environment = process.env,
) {
  await acquireCapacityLock(tx, PPT_QUEUE_CAPACITY_LOCK);
  const maxPending = getPptGlobalMaxPending(environment);
  const pending = await tx.pptProject.count({
    where: { status: { in: [...PPT_CAPACITY_STATUSES] } },
  });
  return { allowed: pending < maxPending, pending, maxPending };
}

async function acquireCapacityLock(
  tx: Prisma.TransactionClient,
  lockName: string,
) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
  `;
}
