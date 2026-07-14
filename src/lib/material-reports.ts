import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type MaterialReportTransaction = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "material" | "materialReport"
>;

export interface MaterialReportDatabase {
  $transaction<T>(
    callback: (tx: MaterialReportTransaction) => Promise<T>,
  ): Promise<T>;
}

export type CreateMaterialReportResult =
  | "created"
  | "already-reported"
  | "not-found"
  | "own-material";

export async function createMaterialReport(
  input: { materialId: string; reporterId: string; reason: string },
  database: MaterialReportDatabase = prisma,
): Promise<CreateMaterialReportResult> {
  return database.$transaction(async (tx) => {
    const lockName = `material-report:${input.reporterId}:${input.materialId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
    `;

    const material = await tx.material.findFirst({
      where: {
        id: input.materialId,
        visibility: "PUBLIC",
        status: "APPROVED",
      },
      select: { ownerId: true },
    });
    if (!material) return "not-found";
    if (material.ownerId === input.reporterId) return "own-material";

    const existing = await tx.materialReport.findFirst({
      where: {
        materialId: input.materialId,
        reporterId: input.reporterId,
        status: "OPEN",
      },
      select: { id: true },
    });
    if (existing) return "already-reported";

    await tx.materialReport.create({
      data: {
        materialId: input.materialId,
        reporterId: input.reporterId,
        reason: input.reason,
      },
    });
    return "created";
  });
}
