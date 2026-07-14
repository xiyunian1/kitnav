import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_READINESS_INTEGRATION_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_READINESS_INTEGRATION_URL is required");
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_test")) {
  throw new Error("Integration database name must end with _test");
}

process.env.DATABASE_URL = databaseUrl;

async function main() {
  const { prisma } = await import("@/lib/db");
  const { assertDatabaseReady } = await import("@/lib/database-readiness");
  const id = randomUUID();
  const migrationName = `readiness_probe_${id.replaceAll("-", "")}`;

  try {
    await assertDatabaseReady();
    await prisma.$executeRaw`
      INSERT INTO "_prisma_migrations" (
        "id",
        "checksum",
        "migration_name",
        "started_at",
        "applied_steps_count"
      ) VALUES (
        ${id},
        'integration-check',
        ${migrationName},
        NOW(),
        0
      )
    `;

    await assert.rejects(assertDatabaseReady, /unfinished migrations/);

    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET "rolled_back_at" = NOW()
      WHERE "id" = ${id}
    `;
    await assertDatabaseReady();
    console.log("Database readiness integration check passed.");
  } finally {
    await prisma.$executeRaw`
      DELETE FROM "_prisma_migrations"
      WHERE "id" = ${id}
    `.catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
