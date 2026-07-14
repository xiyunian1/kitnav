const DEFAULT_DATABASE_CONNECTION_LIMIT = 10;
const DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS = 10;
const MAX_DATABASE_CONNECTION_LIMIT = 1_000;
const MAX_DATABASE_POOL_TIMEOUT_SECONDS = 300;

export const DEFAULT_DATABASE_POOL_BUDGET = {
  app: 10,
  imageWorker: 5,
  pptWorker: 5,
  postgresMaxConnections: 100,
  reservedConnections: 10,
} as const;

type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export interface DatabasePoolBudget {
  app: number;
  imageWorker: number;
  pptWorker: number;
  total: number;
  postgresMaxConnections: number;
  reservedConnections: number;
  poolTimeoutSeconds: number;
  source: "database-url" | "service-settings";
}

function parseBoundedInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const configured = raw?.trim();
  if (!configured) return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function parsePostgresUrl(raw: string | undefined) {
  const configured = raw?.trim();
  if (!configured) return null;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql or postgres protocol.");
  }
  return url;
}

function readUrlInteger(
  url: URL,
  name: "connection_limit" | "pool_timeout",
  min: number,
  max: number,
) {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return null;
  if (values.length !== 1) {
    throw new Error(`DATABASE_URL must contain at most one ${name} parameter.`);
  }
  if (!values[0]?.trim()) {
    throw new Error(`DATABASE_URL ${name} must not be empty.`);
  }
  return parseBoundedInteger(
    `DATABASE_URL ${name}`,
    values[0],
    min,
    min,
    max,
  );
}

export function hasPostgresDatabaseUrl(
  environment: DatabaseEnvironment = process.env,
) {
  const url = environment.DATABASE_URL?.trim().toLowerCase() ?? "";
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export function resolvePrismaDatabaseUrl(
  environment: DatabaseEnvironment = process.env,
) {
  const url = parsePostgresUrl(environment.DATABASE_URL);
  if (!url) return undefined;

  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set(
      "connection_limit",
      String(
        parseBoundedInteger(
          "DATABASE_CONNECTION_LIMIT",
          environment.DATABASE_CONNECTION_LIMIT,
          DEFAULT_DATABASE_CONNECTION_LIMIT,
          1,
          MAX_DATABASE_CONNECTION_LIMIT,
        ),
      ),
    );
  } else {
    readUrlInteger(
      url,
      "connection_limit",
      1,
      MAX_DATABASE_CONNECTION_LIMIT,
    );
  }

  if (!url.searchParams.has("pool_timeout")) {
    url.searchParams.set(
      "pool_timeout",
      String(
        parseBoundedInteger(
          "DATABASE_POOL_TIMEOUT_SECONDS",
          environment.DATABASE_POOL_TIMEOUT_SECONDS,
          DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS,
          1,
          MAX_DATABASE_POOL_TIMEOUT_SECONDS,
        ),
      ),
    );
  } else {
    readUrlInteger(
      url,
      "pool_timeout",
      1,
      MAX_DATABASE_POOL_TIMEOUT_SECONDS,
    );
  }

  return url.toString();
}

export function resolveDatabasePoolBudget(
  environment: DatabaseEnvironment,
): DatabasePoolBudget {
  const url = parsePostgresUrl(environment.DATABASE_URL);
  if (!url) throw new Error("DATABASE_URL is required.");
  const urlConnectionLimit = readUrlInteger(
    url,
    "connection_limit",
    1,
    MAX_DATABASE_CONNECTION_LIMIT,
  );
  const urlPoolTimeout = readUrlInteger(
    url,
    "pool_timeout",
    1,
    MAX_DATABASE_POOL_TIMEOUT_SECONDS,
  );
  const app =
    urlConnectionLimit ??
    parseBoundedInteger(
      "APP_DATABASE_CONNECTION_LIMIT",
      environment.APP_DATABASE_CONNECTION_LIMIT,
      DEFAULT_DATABASE_POOL_BUDGET.app,
      1,
      MAX_DATABASE_CONNECTION_LIMIT,
    );
  const imageWorker =
    urlConnectionLimit ??
    parseBoundedInteger(
      "IMAGE_WORKER_DATABASE_CONNECTION_LIMIT",
      environment.IMAGE_WORKER_DATABASE_CONNECTION_LIMIT,
      DEFAULT_DATABASE_POOL_BUDGET.imageWorker,
      1,
      MAX_DATABASE_CONNECTION_LIMIT,
    );
  const pptWorker =
    urlConnectionLimit ??
    parseBoundedInteger(
      "PPT_WORKER_DATABASE_CONNECTION_LIMIT",
      environment.PPT_WORKER_DATABASE_CONNECTION_LIMIT,
      DEFAULT_DATABASE_POOL_BUDGET.pptWorker,
      1,
      MAX_DATABASE_CONNECTION_LIMIT,
    );
  const postgresMaxConnections = parseBoundedInteger(
    "POSTGRES_MAX_CONNECTIONS",
    environment.POSTGRES_MAX_CONNECTIONS,
    DEFAULT_DATABASE_POOL_BUDGET.postgresMaxConnections,
    20,
    10_000,
  );
  const reservedConnections = parseBoundedInteger(
    "DATABASE_RESERVED_CONNECTIONS",
    environment.DATABASE_RESERVED_CONNECTIONS,
    DEFAULT_DATABASE_POOL_BUDGET.reservedConnections,
    1,
    postgresMaxConnections - 1,
  );
  const poolTimeoutSeconds =
    urlPoolTimeout ??
    parseBoundedInteger(
      "DATABASE_POOL_TIMEOUT_SECONDS",
      environment.DATABASE_POOL_TIMEOUT_SECONDS,
      DEFAULT_DATABASE_POOL_TIMEOUT_SECONDS,
      1,
      MAX_DATABASE_POOL_TIMEOUT_SECONDS,
    );
  const total = app + imageWorker + pptWorker;
  const usableConnections = postgresMaxConnections - reservedConnections;
  if (total > usableConnections) {
    throw new Error(
      `Database pool budget ${total} exceeds the usable PostgreSQL limit ${usableConnections}.`,
    );
  }

  return {
    app,
    imageWorker,
    pptWorker,
    total,
    postgresMaxConnections,
    reservedConnections,
    poolTimeoutSeconds,
    source: urlConnectionLimit === null ? "service-settings" : "database-url",
  };
}
