import { prisma } from "@/lib/db";

export const REQUIRED_DATABASE_MIGRATIONS = [
  "20260711000000_baseline",
  "20260711010000_distributed_rate_limits",
  "20260711020000_image_worker_queue",
  "20260711030000_ppt_storage_retention",
  "20260711040000_private_upload_indexes",
  "20260712010000_image_conversation_pagination",
  "20260713010000_query_and_foreign_key_indexes",
  "20260713020000_ppt_worker_leases",
  "20260714010000_user_session_version",
  "20260718010000_ppt_planning_confirmation",
  "20260722010000_ppt_confirmation_timing",
  "20260722020000_image_multi_reference_inputs",
  "20260723010000_ppt_active_generation_timing",
  "20260724010000_image_result_retention",
  "20260724020000_guest_showcase_mode",
] as const;

export interface MigrationReadinessRow {
  migrationName: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

export function assertRequiredMigrationsApplied(
  migrations: MigrationReadinessRow[],
) {
  const unresolved = migrations
    .filter((migration) => !migration.finishedAt && !migration.rolledBackAt)
    .map((migration) => migration.migrationName);
  if (unresolved.length > 0) {
    throw new Error(
      `Database has unfinished migrations: ${unresolved.join(", ")}`,
    );
  }

  const applied = new Set(
    migrations
      .filter((migration) => migration.finishedAt && !migration.rolledBackAt)
      .map((migration) => migration.migrationName),
  );
  const missing = REQUIRED_DATABASE_MIGRATIONS.filter(
    (migration) => !applied.has(migration),
  );
  if (missing.length > 0) {
    throw new Error(`Database is missing migrations: ${missing.join(", ")}`);
  }
}

export async function assertDatabaseReady() {
  const migrations = await prisma.$queryRaw<MigrationReadinessRow[]>`
    SELECT
      "migration_name" AS "migrationName",
      "finished_at" AS "finishedAt",
      "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations"
  `;
  assertRequiredMigrationsApplied(migrations);

  // Resolve the columns used by queue claiming, billing, and shared limits.
  // WHERE FALSE keeps this probe independent of table size and user data.
  await prisma.$queryRaw`
    SELECT
      (SELECT "credits" FROM "User" WHERE FALSE) AS "userCredits",
      (SELECT "sessionVersion" FROM "User" WHERE FALSE) AS "userSessionVersion",
      (SELECT "workerLease" FROM "ImageTurn" WHERE FALSE) AS "imageLease",
      (SELECT "heartbeatAt" FROM "ImageTurn" WHERE FALSE) AS "imageHeartbeat",
      (SELECT "cancelRequestedAt" FROM "ImageTurn" WHERE FALSE) AS "imageCancellation",
      (SELECT "editInputs" FROM "ImageTurn" WHERE FALSE) AS "imageEditInputs",
      (SELECT "completedAt" FROM "ImageTurn" WHERE FALSE) AS "imageCompletedAt",
      (SELECT "artifactsDeletedAt" FROM "ImageTurn" WHERE FALSE) AS "imageRetention",
      (SELECT "params" FROM "PptProject" WHERE FALSE) AS "pptParams",
      (SELECT "workerLease" FROM "PptProject" WHERE FALSE) AS "pptLease",
      (SELECT "artifactsDeletedAt" FROM "PptProject" WHERE FALSE) AS "pptRetention",
      (SELECT "confirmationWaitStartedAt" FROM "PptProject" WHERE FALSE) AS "pptConfirmationWaitStartedAt",
      (SELECT "confirmationWaitSeconds" FROM "PptProject" WHERE FALSE) AS "pptConfirmationWaitSeconds",
      (SELECT "activeGenerationStartedAt" FROM "PptProject" WHERE FALSE) AS "pptActiveGenerationStartedAt",
      (SELECT "activeGenerationSeconds" FROM "PptProject" WHERE FALSE) AS "pptActiveGenerationSeconds",
      (SELECT "expiresAt" FROM "RateLimitBucket" WHERE FALSE) AS "rateLimitExpiry"
  `;
}
