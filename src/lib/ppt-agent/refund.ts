import { prisma } from "@/lib/db";

export async function refundPptProjectCredits(projectId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.pptProject.findUnique({
      where: { id: projectId },
      select: {
        userId: true,
        creditsCost: true,
        usedOwnKey: true,
      },
    });
    if (!project || project.usedOwnKey || project.creditsCost <= 0) return false;

    const claimed = await tx.pptProject.updateMany({
      where: {
        id: projectId,
        status: "FAILED",
        creditsCost: project.creditsCost,
        usedOwnKey: false,
      },
      data: { creditsCost: 0, workerLease: null },
    });
    if (claimed.count !== 1) return false;

    const updated = await tx.user.update({
      where: { id: project.userId },
      data: { credits: { increment: project.creditsCost } },
    });

    await tx.creditTransaction.create({
      data: {
        userId: project.userId,
        amount: project.creditsCost,
        type: "REFUND",
        balanceAfter: updated.credits,
        description: reason,
      },
    });

    return true;
  });
}

export async function reconcilePptProjectCredits(
  projectId: string,
  targetCreditsCost: number,
  reason: string,
  expectedLease?: string,
) {
  const normalizedTarget = Math.max(0, Math.floor(targetCreditsCost));

  return prisma.$transaction(async (tx) => {
    const project = await tx.pptProject.findUnique({
      where: { id: projectId },
      select: { userId: true, creditsCost: true },
    });
    if (!project || project.creditsCost <= normalizedTarget) return 0;
    const amount = project.creditsCost - normalizedTarget;

    const claimed = await tx.pptProject.updateMany({
      where: {
        id: projectId,
        creditsCost: project.creditsCost,
        ...(expectedLease ? { workerLease: expectedLease } : {}),
      },
      data: { creditsCost: normalizedTarget },
    });
    if (claimed.count !== 1) return 0;

    const updated = await tx.user.update({
      where: { id: project.userId },
      data: { credits: { increment: amount } },
    });
    await tx.creditTransaction.create({
      data: {
        userId: project.userId,
        amount,
        type: "REFUND",
        balanceAfter: updated.credits,
        description: reason,
      },
    });
    return amount;
  });
}

export async function sweepPendingPptRefunds(limit = 20) {
  const normalizedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const projects = await prisma.pptProject.findMany({
    where: {
      status: "FAILED",
      usedOwnKey: false,
      creditsCost: { gt: 0 },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: normalizedLimit,
  });
  let refunded = 0;
  let failed = 0;
  for (const project of projects) {
    try {
      if (
        await refundPptProjectCredits(
          project.id,
          `PPT 失败任务补偿退款（${project.id}）`,
        )
      ) {
        refunded += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { scanned: projects.length, refunded, failed };
}
