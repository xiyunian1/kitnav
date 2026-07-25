import type { Prisma, Role, UserStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

const ADMIN_ACCESS_LOCK_NAME = "admin-user-access";

interface UserAccessState {
  role: Role;
  status: UserStatus;
}

interface UserAccessUpdate {
  role?: Role;
  status?: UserStatus;
}

export type UserAccessUpdateResult =
  | "updated"
  | "not-found"
  | "protected-guest"
  | "last-active-admin";

export function removesActiveAdminAccess(
  current: UserAccessState,
  update: UserAccessUpdate,
) {
  const currentlyActiveAdmin =
    current.role === "ADMIN" && current.status === "ACTIVE";
  const nextRole = update.role ?? current.role;
  const nextStatus = update.status ?? current.status;
  return (
    currentlyActiveAdmin &&
    (nextRole !== "ADMIN" || nextStatus !== "ACTIVE")
  );
}

export async function updateUserAccessSafely(
  userId: string,
  update: UserAccessUpdate,
): Promise<UserAccessUpdateResult> {
  return prisma.$transaction(
    (tx) => updateUserAccessSafelyInTransaction(tx, userId, update),
    { maxWait: 10_000, timeout: 15_000 },
  );
}

export async function updateUserAccessSafelyInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  update: UserAccessUpdate,
): Promise<UserAccessUpdateResult> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${ADMIN_ACCESS_LOCK_NAME}, 0)
    )
  `;
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  });
  if (!current) return "not-found";
  if (current.role === "GUEST") return "protected-guest";

  if (removesActiveAdminAccess(current, update)) {
    const activeAdmins = await tx.user.count({
      where: { role: "ADMIN", status: "ACTIVE" },
    });
    if (activeAdmins <= 1) return "last-active-admin";
  }

  await tx.user.update({ where: { id: userId }, data: update });
  return "updated";
}
