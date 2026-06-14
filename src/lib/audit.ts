import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function writeAuditLog(input: {
  action: string;
  target?: string;
  detail?: unknown;
  adminId?: string | null;
}) {
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

  const detail =
    typeof input.detail === "string"
      ? input.detail
      : input.detail === undefined
        ? undefined
        : JSON.stringify(input.detail).slice(0, 2000);

  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: input.action,
      target: input.target,
      detail,
    },
  });
}
