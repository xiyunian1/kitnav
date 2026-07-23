import assert from "node:assert/strict";

const databaseUrl = process.env.PPT_QUEUE_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("PPT_QUEUE_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_ppt_queue_test")) {
  throw new Error("Integration database name must end with _ppt_queue_test");
}

process.env.DATABASE_URL = databaseUrl;
process.env.PPT_AGENT_MAX_CONCURRENT = "1";
process.env.PPT_WORKER_POLL_MS = "100";

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for PPT worker integration state");
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const {
    claimNextPptProject,
    heartbeatPptProject,
    releaseStaleProject,
    requeuePptProject,
    sweepStalePptProjects,
  } = await import("@/lib/ppt-agent/queue");
  const { markPptProjectCancelled } = await import(
    "@/lib/ppt-agent/cancellation"
  );
  const { appendProjectLog, updateProject } = await import(
    "@/lib/ppt-agent/project-log"
  );
  const { startPptWorker, stopPptWorker } = await import(
    "@/lib/ppt-agent/worker"
  );
  const { refundPptProjectCredits, sweepPendingPptRefunds } = await import(
    "@/lib/ppt-agent/refund"
  );
  const userId = "ppt-queue-integration-user";
  const refundProjectId = "ppt-queue-refund";

  try {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: {
        id: userId,
        email: "ppt-queue-integration@example.com",
        credits: 70,
      },
    });
    const createdAt = Date.now() - 60_000;
    await prisma.pptProject.createMany({
      data: [
        {
          id: refundProjectId,
          userId,
          title: "Refund project",
          sourceType: "TOPIC",
          status: "QUEUED",
          creditsCost: 30,
          createdAt: new Date(createdAt),
        },
        {
          id: "ppt-queue-second",
          userId,
          title: "Second project",
          sourceType: "TOPIC",
          status: "QUEUED",
          createdAt: new Date(createdAt + 1),
        },
        {
          id: "ppt-queue-third",
          userId,
          title: "Third project",
          sourceType: "TOPIC",
          status: "QUEUED",
          createdAt: new Date(createdAt + 2),
        },
      ],
    });

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimNextPptProject()),
    );
    const claimed = claims.filter(
      (value): value is NonNullable<typeof value> => value !== null,
    );
    assert.equal(claimed.length, 3);
    assert.equal(new Set(claimed.map((value) => value.id)).size, 3);
    assert.equal(new Set(claimed.map((value) => value.lease)).size, 3);
    assert.equal(await claimNextPptProject(), null);
    const refundClaim = claimed.find((value) => value.id === refundProjectId);
    assert(refundClaim);
    const claimedRefundProject = await prisma.pptProject.findUniqueOrThrow({
      where: { id: refundProjectId },
      select: {
        workerLease: true,
        activeGenerationStartedAt: true,
        activeGenerationSeconds: true,
      },
    });
    assert.equal(claimedRefundProject.workerLease, refundClaim.lease);
    assert(claimedRefundProject.activeGenerationStartedAt instanceof Date);
    assert.equal(claimedRefundProject.activeGenerationSeconds, 0);
    await prisma.pptProject.update({
      where: { id: refundProjectId },
      data: {
        activeGenerationStartedAt: new Date(Date.now() - 5_000),
      },
    });

    await Promise.all(
      Array.from({ length: 8 }, () =>
        releaseStaleProject(refundProjectId, "integration timeout", {
          expectedLease: refundClaim.lease,
        }),
      ),
    );
    const refundedProject = await prisma.pptProject.findUniqueOrThrow({
      where: { id: refundProjectId },
    });
    assert.equal(refundedProject.status, "FAILED");
    assert.equal(refundedProject.creditsCost, 0);
    assert.equal(refundedProject.activeGenerationStartedAt, null);
    assert(
      refundedProject.activeGenerationSeconds >= 4 &&
        refundedProject.activeGenerationSeconds <= 10,
    );
    assert.match(refundedProject.logs ?? "", /integration timeout/);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      100,
    );
    assert.equal(
      await prisma.creditTransaction.count({
        where: { userId, type: "REFUND" },
      }),
      1,
    );
    await assert.rejects(
      updateProject(
        refundProjectId,
        { status: "COMPLETED", currentPhase: "late completion" },
        refundClaim.lease,
      ),
      /租约已失效/,
    );
    await assert.rejects(
      appendProjectLog(
        refundProjectId,
        "late worker log",
        refundClaim.lease,
      ),
      /租约已失效/,
    );
    assert.equal(
      await heartbeatPptProject(refundProjectId, refundClaim.lease),
      false,
    );
    assert.equal(
      await requeuePptProject(refundProjectId, refundClaim.lease),
      false,
    );
    assert.equal(
      (
        await prisma.pptProject.findUniqueOrThrow({
          where: { id: refundProjectId },
        })
      ).status,
      "FAILED",
    );

    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 10 } },
    });
    const staleDate = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await prisma.pptProject.create({
      data: {
        id: "ppt-queue-legacy-stale",
        userId,
        title: "Legacy stale project",
        sourceType: "TOPIC",
        status: "GENERATING",
        creditsCost: 10,
        createdAt: staleDate,
        updatedAt: staleDate,
      },
    });
    assert.equal(await sweepStalePptProjects(), 1);
    const legacy = await prisma.pptProject.findUniqueOrThrow({
      where: { id: "ppt-queue-legacy-stale" },
    });
    assert.equal(legacy.status, "FAILED");
    assert.equal(legacy.creditsCost, 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      100,
    );
    const refunds = await prisma.creditTransaction.findMany({
      where: { userId, type: "REFUND" },
      orderBy: { createdAt: "asc" },
    });
    assert.equal(refunds.length, 2);
    assert.deepEqual(
      refunds.map((refund) => refund.amount).sort((a, b) => a - b),
      [10, 30],
    );

    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 7 } },
    });
    await prisma.pptProject.create({
      data: {
        id: "ppt-queue-pending-refund",
        userId,
        title: "Pending compensation refund",
        sourceType: "TOPIC",
        status: "FAILED",
        creditsCost: 7,
      },
    });
    assert.deepEqual(await sweepPendingPptRefunds(), {
      scanned: 1,
      refunded: 1,
      failed: 0,
    });
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      100,
    );

    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 5 } },
    });
    await prisma.pptProject.create({
      data: {
        id: "ppt-queue-corrupt-params",
        userId,
        title: "Corrupt queued project",
        sourceType: "TOPIC",
        status: "QUEUED",
        params: "{not-json",
        creditsCost: 5,
      },
    });
    startPptWorker();
    try {
      await waitFor(async () => {
        const project = await prisma.pptProject.findUnique({
          where: { id: "ppt-queue-corrupt-params" },
          select: { status: true },
        });
        return project?.status === "FAILED";
      });
    } finally {
      await stopPptWorker();
    }
    const corrupt = await prisma.pptProject.findUniqueOrThrow({
      where: { id: "ppt-queue-corrupt-params" },
    });
    assert.equal(corrupt.status, "FAILED");
    assert.match(corrupt.error ?? "", /入参损坏/);
    assert.equal(corrupt.creditsCost, 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      100,
    );

    await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: 11 } },
    });
    const cancelProjectId = "ppt-queue-cancelled-lease";
    await prisma.pptProject.create({
      data: {
        id: cancelProjectId,
        userId,
        title: "Cancelled leased project",
        sourceType: "TOPIC",
        status: "QUEUED",
        creditsCost: 11,
      },
    });
    const cancelClaim = await claimNextPptProject();
    assert(cancelClaim);
    assert.equal(cancelClaim.id, cancelProjectId);
    assert.equal(
      await releaseStaleProject(cancelProjectId, "must stay active", {
        expectedLease: cancelClaim.lease,
        staleBefore: new Date(Date.now() - 1_000),
      }),
      false,
    );
    const cancelResults = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const cancelled = await markPptProjectCancelled(cancelProjectId, userId);
        if (!cancelled) return false;
        await refundPptProjectCredits(
          cancelProjectId,
          `PPT integration cancellation refund (${cancelProjectId})`,
        );
        return true;
      }),
    );
    assert.equal(cancelResults.filter(Boolean).length, 1);
    await assert.rejects(
      updateProject(
        cancelProjectId,
        { status: "COMPLETED", currentPhase: "late completion" },
        cancelClaim.lease,
      ),
      /租约已失效/,
    );
    assert.equal(
      await heartbeatPptProject(cancelProjectId, cancelClaim.lease),
      false,
    );
    assert.equal(
      await requeuePptProject(cancelProjectId, cancelClaim.lease),
      false,
    );
    const cancelledProject = await prisma.pptProject.findUniqueOrThrow({
      where: { id: cancelProjectId },
    });
    assert.equal(cancelledProject.status, "FAILED");
    assert.equal(cancelledProject.workerLease, null);
    assert.equal(cancelledProject.creditsCost, 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits,
      100,
    );
    assert.equal(
      await prisma.creditTransaction.count({
        where: { userId, type: "REFUND" },
      }),
      5,
    );
    console.log("PPT queue and refund integration check passed.");
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
