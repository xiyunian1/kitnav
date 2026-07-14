-- Add durable queue metadata for image generation jobs.
ALTER TABLE "ImageTurn"
ADD COLUMN "quality" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "editInputPath" TEXT,
ADD COLUMN "editInputName" TEXT,
ADD COLUMN "workerLease" TEXT,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "ImageTurn_status_workerLease_createdAt_idx"
ON "ImageTurn"("status", "workerLease", "createdAt");

CREATE INDEX "ImageTurn_status_heartbeatAt_idx"
ON "ImageTurn"("status", "heartbeatAt");
