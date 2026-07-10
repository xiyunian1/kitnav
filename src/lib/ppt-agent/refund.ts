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
        creditsCost: project.creditsCost,
        usedOwnKey: false,
      },
      data: { creditsCost: 0 },
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

export async function refundPptProjectCreditsAmount(
  projectId: string,
  amount: number,
  reason: string,
) {
  const normalizedAmount = Math.max(0, Math.floor(amount));
  if (normalizedAmount <= 0) return 0;

  return prisma.$transaction(async (tx) => {
    const project = await tx.pptProject.findUnique({
      where: { id: projectId },
      select: { userId: true, creditsCost: true },
    });
    if (!project || project.creditsCost < normalizedAmount) return 0;

    const claimed = await tx.pptProject.updateMany({
      where: { id: projectId, creditsCost: project.creditsCost },
      data: { creditsCost: { decrement: normalizedAmount } },
    });
    if (claimed.count !== 1) return 0;

    const updated = await tx.user.update({
      where: { id: project.userId },
      data: { credits: { increment: normalizedAmount } },
    });
    await tx.creditTransaction.create({
      data: {
        userId: project.userId,
        amount: normalizedAmount,
        type: "REFUND",
        balanceAfter: updated.credits,
        description: reason,
      },
    });
    return normalizedAmount;
  });
}
