import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export interface AuditLogInput {
  action: string;
  target?: string;
  detail?: unknown;
}

interface StandaloneAuditLogInput extends AuditLogInput {
  adminId?: string | null;
}

type AuditTransaction = Pick<Prisma.TransactionClient, "adminAuditLog">;

export interface AuditDatabase {
  $transaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

export function serializeAuditDetail(detail: unknown) {
  if (detail === undefined) return undefined;
  const value = typeof detail === "string" ? detail : JSON.stringify(detail);
  return value.slice(0, 2000);
}

export async function createAuditLogInTransaction(
  tx: AuditTransaction,
  input: AuditLogInput & { adminId: string },
) {
  await tx.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      target: input.target,
      detail: serializeAuditDetail(input.detail),
    },
  });
}

export async function runAuditedAdminTransaction<T>(
  adminId: string,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  audit:
    | AuditLogInput
    | ((result: T) => AuditLogInput | null),
  database: AuditDatabase = prisma,
) {
  return database.$transaction(
    async (tx) => {
      const activeAdmin = await tx.user.findFirst({
        where: { id: adminId, role: "ADMIN", status: "ACTIVE" },
        select: { id: true },
      });
      if (!activeAdmin) throw new Error("管理员权限已失效");

      const result = await mutation(tx);
      const entry = typeof audit === "function" ? audit(result) : audit;
      if (entry) {
        await createAuditLogInTransaction(tx, { ...entry, adminId });
      }
      return result;
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

export async function writeAuditLog(input: StandaloneAuditLogInput) {
  let adminId = input.adminId ?? null;
  if (adminId === null) {
    try {
      const session = await auth();
      adminId = session?.user?.id ?? null;
    } catch {
      adminId = null;
    }
  }

  if (adminId) {
    const admin = await prisma.user.findUnique({
      where: { id: adminId },
      select: { id: true },
    });
    adminId = admin?.id ?? null;
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: input.action,
      target: input.target,
      detail: serializeAuditDetail(input.detail),
    },
  });
}
