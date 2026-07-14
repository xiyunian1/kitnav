-- Fence PPT worker writes so a timed-out or cancelled worker cannot revive a job.
ALTER TABLE "PptProject"
ADD COLUMN "workerLease" TEXT;

CREATE INDEX "PptProject_status_workerLease_createdAt_idx"
ON "PptProject"("status", "workerLease", "createdAt");
