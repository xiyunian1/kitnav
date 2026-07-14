-- Match PPT queue and stale-task queries with composite indexes, and track
-- artifact retention independently from project metadata retention.
ALTER TABLE "PptProject"
ADD COLUMN "artifactsDeletedAt" TIMESTAMP(3);

DROP INDEX "PptProject_status_idx";

CREATE INDEX "PptProject_status_createdAt_idx"
ON "PptProject"("status", "createdAt");

CREATE INDEX "PptProject_status_updatedAt_idx"
ON "PptProject"("status", "updatedAt");

CREATE INDEX "PptProject_status_completedAt_idx"
ON "PptProject"("status", "completedAt");
