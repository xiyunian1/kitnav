import { describe, expect, it } from "vitest";
import {
  hasPostgresDatabaseUrl,
  resolveDatabasePoolBudget,
  resolvePrismaDatabaseUrl,
} from "./database-url";

const DATABASE_URL =
  "postgresql://user:password@postgres:5432/app?schema=public";

describe("database URL configuration", () => {
  it("adds bounded Prisma pool defaults without losing existing parameters", () => {
    const resolved = new URL(
      resolvePrismaDatabaseUrl({ DATABASE_URL }) ?? "",
    );

    expect(resolved.searchParams.get("schema")).toBe("public");
    expect(resolved.searchParams.get("connection_limit")).toBe("10");
    expect(resolved.searchParams.get("pool_timeout")).toBe("10");
  });

  it("uses service settings but preserves explicit URL parameters", () => {
    const configured = new URL(
      resolvePrismaDatabaseUrl({
        DATABASE_URL,
        DATABASE_CONNECTION_LIMIT: "7",
        DATABASE_POOL_TIMEOUT_SECONDS: "15",
      }) ?? "",
    );
    expect(configured.searchParams.get("connection_limit")).toBe("7");
    expect(configured.searchParams.get("pool_timeout")).toBe("15");

    const explicit = new URL(
      resolvePrismaDatabaseUrl({
        DATABASE_URL: `${DATABASE_URL}&connection_limit=3&pool_timeout=4`,
        DATABASE_CONNECTION_LIMIT: "7",
        DATABASE_POOL_TIMEOUT_SECONDS: "15",
      }) ?? "",
    );
    expect(explicit.searchParams.get("connection_limit")).toBe("3");
    expect(explicit.searchParams.get("pool_timeout")).toBe("4");
  });

  it("rejects malformed, duplicate, and unsafe pool settings", () => {
    expect(() =>
      resolvePrismaDatabaseUrl({
        DATABASE_URL,
        DATABASE_CONNECTION_LIMIT: "0",
      }),
    ).toThrow("DATABASE_CONNECTION_LIMIT");
    expect(() =>
      resolvePrismaDatabaseUrl({
        DATABASE_URL: `${DATABASE_URL}&connection_limit=2&connection_limit=3`,
      }),
    ).toThrow("at most one connection_limit");
    expect(() =>
      resolvePrismaDatabaseUrl({
        DATABASE_URL: `${DATABASE_URL}&connection_limit=`,
      }),
    ).toThrow("connection_limit must not be empty");
    expect(() =>
      resolvePrismaDatabaseUrl({ DATABASE_URL: "mysql://localhost/app" }),
    ).toThrow("postgresql or postgres");
  });

  it("calculates a role-specific production connection budget", () => {
    expect(resolveDatabasePoolBudget({ DATABASE_URL })).toEqual({
      app: 10,
      imageWorker: 5,
      pptWorker: 5,
      total: 20,
      postgresMaxConnections: 100,
      reservedConnections: 10,
      poolTimeoutSeconds: 10,
      source: "service-settings",
    });
  });

  it("applies a URL connection limit to every process and rejects oversubscription", () => {
    expect(
      resolveDatabasePoolBudget({
        DATABASE_URL: `${DATABASE_URL}&connection_limit=20&pool_timeout=5`,
      }),
    ).toMatchObject({
      app: 20,
      imageWorker: 20,
      pptWorker: 20,
      total: 60,
      poolTimeoutSeconds: 5,
      source: "database-url",
    });

    expect(() =>
      resolveDatabasePoolBudget({
        DATABASE_URL: `${DATABASE_URL}&connection_limit=31`,
      }),
    ).toThrow("exceeds the usable PostgreSQL limit");
  });

  it("recognizes PostgreSQL URLs without throwing for missing values", () => {
    expect(hasPostgresDatabaseUrl({ DATABASE_URL: "POSTGRES://host/db" })).toBe(
      true,
    );
    expect(hasPostgresDatabaseUrl({})).toBe(false);
    expect(resolvePrismaDatabaseUrl({})).toBeUndefined();
  });
});
