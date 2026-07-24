-- Generated image files expire independently from reusable prompt history.
ALTER TABLE "ImageTurn"
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "artifactsDeletedAt" TIMESTAMP(3);

UPDATE "ImageTurn"
SET "completedAt" = "updatedAt"
WHERE "status" IN ('SUCCESS', 'FAILED')
  AND "completedAt" IS NULL;

CREATE INDEX "ImageTurn_status_completedAt_idx"
ON "ImageTurn"("status", "completedAt");
