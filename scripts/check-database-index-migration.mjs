import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_INDEX_INTEGRATION_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_INDEX_INTEGRATION_URL is required");
}

const parsedUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
if (!databaseName.endsWith("_index_migration_test")) {
  throw new Error(
    "Integration database name must end with _index_migration_test",
  );
}

const repoDir = resolve(import.meta.dirname, "..");
const targetMigration = "20260713010000_query_and_foreign_key_indexes";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const emptySchema = `index_empty_${suffix}`;
const upgradeSchema = `index_upgrade_${suffix}`;
const tempDir = await mkdtemp(join(tmpdir(), "database-index-migration-"));
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

function schemaUrl(schema) {
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function run(command, args, url) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoDir,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`,
        ),
      );
    });
  });
}

async function runProductionMigration(url) {
  await run("sh", ["scripts/migrate-production-db.sh"], url);
  await run(process.execPath, ["scripts/check-database-indexes.mjs"], url);
}

async function preparePriorMigrations() {
  const sourceDir = join(repoDir, "prisma");
  const destinationDir = join(tempDir, "prisma");
  const destinationMigrations = join(destinationDir, "migrations");
  await mkdir(destinationMigrations, { recursive: true });
  await cp(
    join(sourceDir, "schema.prisma"),
    join(destinationDir, "schema.prisma"),
  );
  await cp(
    join(sourceDir, "migrations", "migration_lock.toml"),
    join(destinationMigrations, "migration_lock.toml"),
  );

  const migrations = (await readdir(join(sourceDir, "migrations"), {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrations.indexOf(targetMigration);
  if (targetIndex < 1) {
    throw new Error(`Could not find prior migrations for ${targetMigration}`);
  }

  for (const migration of migrations.slice(0, targetIndex)) {
    await cp(
      join(sourceDir, "migrations", migration),
      join(destinationMigrations, migration),
      { recursive: true },
    );
  }
  return join(destinationDir, "schema.prisma");
}

try {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${emptySchema}"`);
  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${upgradeSchema}"`);

  console.log("Checking production migrations against an empty database schema.");
  await runProductionMigration(schemaUrl(emptySchema));

  console.log("Checking concurrent index preparation against an existing schema.");
  const priorSchema = await preparePriorMigrations();
  await run(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      priorSchema,
    ],
    schemaUrl(upgradeSchema),
  );
  await run(
    process.execPath,
    ["scripts/prepare-production-indexes.mjs"],
    schemaUrl(upgradeSchema),
  );
  await run(
    process.execPath,
    ["scripts/prepare-production-indexes.mjs"],
    schemaUrl(upgradeSchema),
  );
  await runProductionMigration(schemaUrl(upgradeSchema));

  console.log("Database index migration integration checks passed.");
} finally {
  await prisma.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${emptySchema}" CASCADE`,
  );
  await prisma.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`,
  );
  await prisma.$disconnect();
  await rm(tempDir, { recursive: true, force: true });
}
