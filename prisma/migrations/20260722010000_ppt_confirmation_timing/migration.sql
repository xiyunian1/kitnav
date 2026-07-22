-- Exclude time spent waiting for a user's planning decision from PPT
-- generation duration. Existing waiting projects start at their last status
-- update; completed legacy projects are handled from timestamped logs.
ALTER TABLE "PptProject"
ADD COLUMN "confirmationWaitStartedAt" TIMESTAMP(3),
ADD COLUMN "confirmationWaitSeconds" INTEGER NOT NULL DEFAULT 0;

UPDATE "PptProject"
SET "confirmationWaitStartedAt" = "updatedAt"
WHERE "status" = 'AWAITING_CONFIRMATION';

-- Backfill completed legacy waits from the timestamped high-level project log
-- markers. Each start is paired with the next confirmation marker.
WITH "logLines" AS (
  SELECT
    project."id",
    entry."lineNumber",
    CASE
      WHEN entry."line" LIKE '%候选已生成，等待用户确认后继续' THEN 'start'
      WHEN entry."line" LIKE '%用户已确认%，原任务重新入队' THEN 'end'
      ELSE NULL
    END AS "kind",
    substring(entry."line" FROM 2 FOR 24)::timestamptz AS "loggedAt"
  FROM "PptProject" AS project
  CROSS JOIN LATERAL regexp_split_to_table(
    COALESCE(project."logs", ''),
    E'\\r?\\n'
  ) WITH ORDINALITY AS entry("line", "lineNumber")
  WHERE entry."line" ~ '^\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{12}Z\]'
    AND (
      entry."line" LIKE '%候选已生成，等待用户确认后继续'
      OR entry."line" LIKE '%用户已确认%，原任务重新入队'
    )
),
"waitIntervals" AS (
  SELECT
    started."id",
    started."loggedAt" AS "startedAt",
    finished."loggedAt" AS "finishedAt"
  FROM "logLines" AS started
  CROSS JOIN LATERAL (
    SELECT candidate."loggedAt"
    FROM "logLines" AS candidate
    WHERE candidate."id" = started."id"
      AND candidate."kind" = 'end'
      AND candidate."lineNumber" > started."lineNumber"
    ORDER BY candidate."lineNumber"
    LIMIT 1
  ) AS finished
  WHERE started."kind" = 'start'
),
"waitTotals" AS (
  SELECT
    "id",
    floor(
      sum(extract(epoch FROM ("finishedAt" - "startedAt")))
    )::integer AS "waitSeconds"
  FROM "waitIntervals"
  WHERE "finishedAt" >= "startedAt"
  GROUP BY "id"
)
UPDATE "PptProject" AS project
SET "confirmationWaitSeconds" = GREATEST(
  project."confirmationWaitSeconds",
  totals."waitSeconds"
)
FROM "waitTotals" AS totals
WHERE project."id" = totals."id";
