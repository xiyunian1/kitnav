-- Track only time while a PPT worker owns the project lease. Queueing,
-- confirmation waits, and time between a failed run and a user retry are
-- intentionally excluded.
ALTER TABLE "PptProject"
ADD COLUMN "activeGenerationStartedAt" TIMESTAMP(3),
ADD COLUMN "activeGenerationSeconds" INTEGER NOT NULL DEFAULT 0;

-- Preserve a useful duration for legacy rows that finished a run or are
-- waiting for confirmation. Exact lease intervals were not stored before this
-- migration, so this one-time backfill keeps the previous best estimate while
-- all new intervals are measured from leases.
UPDATE "PptProject"
SET "activeGenerationSeconds" = GREATEST(
  0,
  floor(
    extract(
      epoch FROM (
        COALESCE("completedAt", "updatedAt") - "createdAt"
      )
    )
  )::integer - "confirmationWaitSeconds"
)
WHERE "status" IN ('COMPLETED', 'READY', 'FAILED', 'AWAITING_CONFIRMATION');

-- Existing leased projects start accurate measurement from their latest
-- heartbeat. Historical time before deployment cannot be reconstructed.
UPDATE "PptProject"
SET "activeGenerationStartedAt" = "updatedAt"
WHERE "workerLease" IS NOT NULL;

CREATE OR REPLACE FUNCTION "trackPptActiveGenerationTiming"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  measured_at TIMESTAMP(3) := clock_timestamp();
  elapsed_seconds INTEGER := 0;
BEGIN
  IF OLD."workerLease" IS NULL AND NEW."workerLease" IS NOT NULL THEN
    NEW."activeGenerationStartedAt" := measured_at;
    RETURN NEW;
  END IF;

  IF OLD."workerLease" IS NOT NULL AND NEW."workerLease" IS NULL THEN
    IF OLD."activeGenerationStartedAt" IS NOT NULL THEN
      elapsed_seconds := GREATEST(
        0,
        floor(
          extract(epoch FROM (measured_at - OLD."activeGenerationStartedAt"))
        )::integer
      );
    END IF;
    NEW."activeGenerationSeconds" :=
      COALESCE(OLD."activeGenerationSeconds", 0) + elapsed_seconds;
    NEW."activeGenerationStartedAt" := NULL;
    RETURN NEW;
  END IF;

  IF OLD."workerLease" IS NOT NULL
    AND NEW."workerLease" IS NOT NULL
    AND OLD."workerLease" IS DISTINCT FROM NEW."workerLease" THEN
    IF OLD."activeGenerationStartedAt" IS NOT NULL THEN
      elapsed_seconds := GREATEST(
        0,
        floor(
          extract(epoch FROM (measured_at - OLD."activeGenerationStartedAt"))
        )::integer
      );
    END IF;
    NEW."activeGenerationSeconds" :=
      COALESCE(OLD."activeGenerationSeconds", 0) + elapsed_seconds;
    NEW."activeGenerationStartedAt" := measured_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "PptProject_active_generation_timing"
BEFORE UPDATE OF "workerLease" ON "PptProject"
FOR EACH ROW
EXECUTE FUNCTION "trackPptActiveGenerationTiming"();
