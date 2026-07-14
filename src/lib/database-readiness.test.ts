import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertRequiredMigrationsApplied,
  REQUIRED_DATABASE_MIGRATIONS,
  type MigrationReadinessRow,
} from "./database-readiness";

function appliedMigration(migrationName: string): MigrationReadinessRow {
  return {
    migrationName,
    finishedAt: new Date("2026-07-13T00:00:00.000Z"),
    rolledBackAt: null,
  };
}

describe("database readiness", () => {
  it("keeps the runtime migration roster aligned with migration directories", () => {
    const directories = readdirSync(resolve(process.cwd(), "prisma/migrations"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect([...REQUIRED_DATABASE_MIGRATIONS].sort()).toEqual(directories);
  });

  it("accepts a database with every required migration applied", () => {
    expect(() =>
      assertRequiredMigrationsApplied(
        REQUIRED_DATABASE_MIGRATIONS.map(appliedMigration),
      ),
    ).not.toThrow();
  });

  it("rejects missing or unfinished migrations", () => {
    expect(() =>
      assertRequiredMigrationsApplied(
        REQUIRED_DATABASE_MIGRATIONS.slice(1).map(appliedMigration),
      ),
    ).toThrow("Database is missing migrations");

    expect(() =>
      assertRequiredMigrationsApplied([
        ...REQUIRED_DATABASE_MIGRATIONS.map(appliedMigration),
        {
          migrationName: "future_migration",
          finishedAt: null,
          rolledBackAt: null,
        },
      ]),
    ).toThrow("Database has unfinished migrations");
  });

  it("ignores rolled-back attempts when a required migration later succeeded", () => {
    expect(() =>
      assertRequiredMigrationsApplied([
        ...REQUIRED_DATABASE_MIGRATIONS.map(appliedMigration),
        {
          migrationName: REQUIRED_DATABASE_MIGRATIONS[0],
          finishedAt: null,
          rolledBackAt: new Date("2026-07-13T00:01:00.000Z"),
        },
      ]),
    ).not.toThrow();
  });
});
