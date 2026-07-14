import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseUrl = process.env.UPLOAD_STORAGE_INTEGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("UPLOAD_STORAGE_INTEGRATION_DATABASE_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_upload_storage_test")) {
  throw new Error("Integration database name must end with _upload_storage_test");
}

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

async function main() {
  const root = await mkdtemp(join(tmpdir(), "upload-storage-integration-"));
  process.env.DATABASE_URL = databaseUrl;
  process.env.MATERIAL_UPLOAD_ROOT = join(root, "materials");
  process.env.FEEDBACK_UPLOAD_ROOT = join(root, "feedback");
  process.env.PPT_UPLOAD_ROOT = join(root, "ppt");
  process.env.MATERIAL_USER_QUOTA_BYTES = "1000";
  process.env.MATERIAL_USER_MAX_FILES = "1";
  process.env.FEEDBACK_USER_QUOTA_BYTES = "1000";
  process.env.FEEDBACK_USER_MAX_FILES = "1";
  process.env.PPT_UPLOAD_USER_QUOTA_BYTES = "1000";
  process.env.PPT_UPLOAD_USER_MAX_FILES = "1";

  const { prisma } = await import("@/lib/db");
  const {
    deleteStoredMaterialFile,
    saveImageBlob,
  } = await import("@/lib/materials");
  const {
    deleteFeedbackScreenshots,
    feedbackStorageKeyFromUrl,
    saveFeedbackScreenshots,
  } = await import("@/lib/feedback");
  const {
    sweepOrphanUploadStorage,
    UPLOAD_STORAGE_SWEEP_LOCK_NAME,
  } = await import(
    "@/lib/upload-storage-retention"
  );
  const { savePptUpload } = await import("@/lib/ppt-agent/upload-paths");
  const referenceUserId = "upload_storage_reference_user";

  try {
    await prisma.user.deleteMany({ where: { id: referenceUserId } });
    const materialResults = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        saveImageBlob(new Blob([PNG], { type: "image/png" }), "user_1"),
      ),
    );
    const savedMaterials = materialResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    assert.equal(savedMaterials.length, 1);
    assert.equal(
      materialResults.filter((result) => result.status === "rejected").length,
      7,
    );
    const materialFiles = await readdir(join(root, "materials", "user_1"));
    assert.equal(materialFiles.length, 1);
    assert.equal(
      (await stat(join(root, "materials", "user_1", materialFiles[0]))).mode &
        0o777,
      0o600,
    );

    const feedbackResults = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        saveFeedbackScreenshots(
          [new File([PNG], `screen-${index}.png`, { type: "image/png" })],
          "user_1",
        ),
      ),
    );
    const savedFeedback = feedbackResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    assert.equal(savedFeedback.length, 1);
    assert.equal(
      feedbackResults.filter((result) => result.status === "rejected").length,
      7,
    );
    const feedbackFiles = await readdir(join(root, "feedback", "user_1"));
    assert.equal(feedbackFiles.length, 1);
    assert.equal(
      (await stat(join(root, "feedback", "user_1", feedbackFiles[0]))).mode &
        0o777,
      0o600,
    );

    const pptResults = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        savePptUpload("user_1", `source-${index}.pdf`, Buffer.from(PNG)),
      ),
    );
    assert.equal(
      pptResults.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      pptResults.filter((result) => result.status === "rejected").length,
      7,
    );
    const pptFiles = await readdir(join(root, "ppt", "user_1"));
    assert.equal(pptFiles.length, 1);
    assert.equal(
      (await stat(join(root, "ppt", "user_1", pptFiles[0]))).mode & 0o777,
      0o600,
    );

    await deleteStoredMaterialFile(savedMaterials[0].storageKey);
    await deleteFeedbackScreenshots(savedFeedback[0]);
    assert(feedbackStorageKeyFromUrl(savedFeedback[0][0]));
    await Promise.all([
      rm(join(root, "materials", "user_1"), { recursive: true, force: true }),
      rm(join(root, "feedback", "user_1"), { recursive: true, force: true }),
      rm(join(root, "ppt", "user_1"), { recursive: true, force: true }),
    ]);

    await prisma.user.create({
      data: {
        id: referenceUserId,
        email: "upload-storage-reference@example.com",
      },
    });
    const materialPaths = {
      stored: join(root, "materials", referenceUserId, "stored.png"),
      legacy: join(root, "materials", `${referenceUserId}-legacy.jpg`),
      thumbnail: join(root, "materials", referenceUserId, "thumbnail.gif"),
      turnResult: join(root, "materials", referenceUserId, "turn-result.png"),
      orphan: join(root, "materials", "material_orphan", "orphan.webp"),
      recent: join(root, "materials", "material_recent", "recent.png"),
    };
    const feedbackPaths = {
      referenced: join(root, "feedback", referenceUserId, "screen.png"),
      orphan: join(root, "feedback", "feedback_orphan", "orphan.jpg"),
      recent: join(root, "feedback", "feedback_recent", "recent.webp"),
    };
    await Promise.all([
      mkdir(join(root, "materials", referenceUserId), { recursive: true }),
      mkdir(join(root, "materials", "material_orphan"), { recursive: true }),
      mkdir(join(root, "materials", "material_recent"), { recursive: true }),
      mkdir(join(root, "feedback", referenceUserId), { recursive: true }),
      mkdir(join(root, "feedback", "feedback_orphan"), { recursive: true }),
      mkdir(join(root, "feedback", "feedback_recent"), { recursive: true }),
    ]);
    await Promise.all(
      [...Object.values(materialPaths), ...Object.values(feedbackPaths)].map(
        (path) => writeFile(path, PNG),
      ),
    );

    await prisma.material.create({
      data: {
        ownerId: referenceUserId,
        title: "Referenced material",
        url: `/uploads/materials/${referenceUserId}-legacy.jpg`,
        storageKey: `${referenceUserId}/stored.png`,
        thumbnailUrl: `/uploads/materials/${referenceUserId}/thumbnail.gif`,
      },
    });
    await prisma.feedback.create({
      data: {
        userId: referenceUserId,
        type: "BUG",
        module: "OTHER",
        title: "Referenced feedback",
        content: "Keeps its screenshot",
        screenshotUrls: JSON.stringify([
          `/api/files/feedback/${referenceUserId}/screen.png`,
        ]),
      },
    });
    const conversation = await prisma.imageConversation.create({
      data: {
        userId: referenceUserId,
        title: "Referenced image turn",
      },
    });
    await prisma.imageTurn.create({
      data: {
        conversationId: conversation.id,
        prompt: "Referenced image turn",
        mode: "generate",
        model: "integration-model",
        ratio: "1:1",
        pixelSize: "1024x1024",
        status: "SUCCESS",
        images: JSON.stringify([
          {
            id: "0",
            status: "success",
            url: `/api/files/materials/${referenceUserId}/turn-result.png`,
          },
        ]),
      },
    });
    const now = Date.now();
    const old = new Date(now - 2 * 60 * 60 * 1000);
    await Promise.all([
      utimes(materialPaths.stored, old, old),
      utimes(materialPaths.legacy, old, old),
      utimes(materialPaths.thumbnail, old, old),
      utimes(materialPaths.turnResult, old, old),
      utimes(materialPaths.orphan, old, old),
      utimes(join(root, "materials", "material_orphan"), old, old),
      utimes(feedbackPaths.referenced, old, old),
      utimes(feedbackPaths.orphan, old, old),
      utimes(join(root, "feedback", "feedback_orphan"), old, old),
    ]);

    const sweepResult = await sweepOrphanUploadStorage({
      now,
      retentionMs: 60 * 60 * 1000,
    });
    assert.deepEqual(sweepResult, {
      rootsScanned: 2,
      filesScanned: 9,
      filesRemoved: 2,
      bytesRemoved: PNG.length * 2,
      directoriesRemoved: 2,
      skipped: false,
    });
    await Promise.all([
      access(materialPaths.stored),
      access(materialPaths.legacy),
      access(materialPaths.thumbnail),
      access(materialPaths.turnResult),
      access(materialPaths.recent),
      access(feedbackPaths.referenced),
      access(feedbackPaths.recent),
    ]);
    await assert.rejects(access(materialPaths.orphan));
    await assert.rejects(access(feedbackPaths.orphan));
    await assert.rejects(access(join(root, "materials", "material_orphan")));
    await assert.rejects(access(join(root, "feedback", "feedback_orphan")));

    let releaseSweepLock!: () => void;
    let markSweepLockReady!: () => void;
    const sweepLockReady = new Promise<void>((resolve) => {
      markSweepLockReady = resolve;
    });
    const releaseSweep = new Promise<void>((resolve) => {
      releaseSweepLock = resolve;
    });
    const lockHolder = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${UPLOAD_STORAGE_SWEEP_LOCK_NAME}, 0)
          )
        `;
        markSweepLockReady();
        await releaseSweep;
      },
      { timeout: 30_000 },
    );
    await sweepLockReady;
    try {
      assert.deepEqual(
        await sweepOrphanUploadStorage({
          now,
          retentionMs: 60 * 60 * 1000,
        }),
        {
          rootsScanned: 0,
          filesScanned: 0,
          filesRemoved: 0,
          bytesRemoved: 0,
          directoriesRemoved: 0,
          skipped: true,
        },
      );
    } finally {
      releaseSweepLock();
      await lockHolder;
    }
    console.log("Upload storage concurrency and retention checks passed.");
  } finally {
    await prisma.user
      .deleteMany({ where: { id: referenceUserId } })
      .catch(() => undefined);
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
