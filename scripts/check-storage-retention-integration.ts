import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseUrl = process.env.STORAGE_RETENTION_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("STORAGE_RETENTION_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_storage_retention_test")) {
  throw new Error("Integration database name must end with _storage_retention_test");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ppt-artifact-retention-"));
  process.env.DATABASE_URL = databaseUrl;
  process.env.PPT_PROJECTS_ROOT = root;
  process.env.PPT_UPLOAD_ROOT = join(root, "uploads");

  const { prisma } = await import("@/lib/db");
  const { sweepExpiredPptArtifacts, sweepPptStorage } = await import(
    "@/lib/ppt-agent/storage-retention"
  );
  const {
    PPT_STORAGE_SWEEP_LOCK_NAME,
    tryAcquirePptStorageReferenceLock,
  } = await import("@/lib/ppt-agent/storage-lock");
  const userId = "storage-retention-integration-user";
  const now = Date.now();
  const old = new Date(now - 8 * 24 * 60 * 60 * 1000);
  const recent = new Date(now - 6 * 24 * 60 * 60 * 1000);

  try {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: {
        id: userId,
        email: "storage-retention-integration@example.com",
      },
    });
    for (const project of [
      { id: "completed-old", status: "COMPLETED" as const, date: old },
      { id: "failed-old", status: "FAILED" as const, date: old },
      { id: "completed-recent", status: "COMPLETED" as const, date: recent },
    ]) {
      const dir = join(root, project.id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "deck.pptx"), project.id);
      await prisma.pptProject.create({
        data: {
          id: project.id,
          userId,
          title: project.id,
          sourceType: "TOPIC",
          topic: "private legacy topic",
          sourceTopic: "private topic",
          sourceFileUrl: "private-upload-token",
          sourceUrl: "https://private.example/source",
          status: project.status,
          projectPath: dir,
          pptxPath: join(dir, "deck.pptx"),
          logs: "private generation log",
          params: JSON.stringify({ sourceMarkdown: "private source" }),
          sourceMarkdown: "private source",
          completedAt: project.status === "COMPLETED" ? project.date : null,
          updatedAt: project.date,
        },
      });
    }

    const result = await sweepExpiredPptArtifacts(now);
    assert.equal(result.projectArtifactsRemoved, 2);
    assert(result.projectArtifactBytesRemoved > 0);

    const oldRows = await prisma.pptProject.findMany({
      where: { id: { in: ["completed-old", "failed-old"] } },
    });
    assert.equal(oldRows.length, 2);
    for (const row of oldRows) {
      assert(row.artifactsDeletedAt);
      assert.equal(row.pptxPath, null);
      assert.equal(row.projectPath, null);
      assert.equal(row.logs, null);
      assert.equal(row.params, null);
      assert.equal(row.topic, null);
      assert.equal(row.sourceTopic, null);
      assert.equal(row.sourceText, null);
      assert.equal(row.sourceMarkdown, null);
      assert.equal(row.sourceFileUrl, null);
      assert.equal(row.sourceUrl, null);
      assert.equal(row.updatedAt.getTime(), old.getTime());
    }
    const recentRow = await prisma.pptProject.findUniqueOrThrow({
      where: { id: "completed-recent" },
    });
    assert.equal(recentRow.artifactsDeletedAt, null);
    assert(recentRow.pptxPath);

    let releaseLock!: () => void;
    let markLockReady!: () => void;
    const lockReady = new Promise<void>((resolve) => {
      markLockReady = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockHolder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${PPT_STORAGE_SWEEP_LOCK_NAME}, 0)
          )
        `;
        markLockReady();
        await release;
      },
      { timeout: 30_000 },
    );
    await lockReady;
    try {
      assert.equal((await sweepPptStorage()).skipped, true);
      assert.equal(
        await prisma.$transaction((tx) =>
          tryAcquirePptStorageReferenceLock(tx),
        ),
        false,
      );
    } finally {
      releaseLock();
      await lockHolder;
    }
    assert.equal((await sweepPptStorage()).skipped, false);
    console.log("Storage retention locking and cleanup checks passed.");
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
