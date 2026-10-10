-- Per-call telemetry for the hosted PPT agent: phase, token usage, cost,
-- duration and outcome of every Pi invocation. Rows are deleted together with
-- their project.
CREATE TABLE "PptAgentRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "stopReason" TEXT,
    "numTurns" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "usageReported" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PptAgentRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PptAgentRun_projectId_createdAt_idx" ON "PptAgentRun"("projectId", "createdAt");
CREATE INDEX "PptAgentRun_createdAt_idx" ON "PptAgentRun"("createdAt");

ALTER TABLE "PptAgentRun"
ADD CONSTRAINT "PptAgentRun_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "PptProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
