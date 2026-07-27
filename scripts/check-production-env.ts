import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { parseEnv } from "node:util";
import { resolveAdminSeedCredentials } from "./admin-credentials";
import { resolveDatabasePoolBudget } from "../src/lib/database-url";
import { isIpAllowed } from "../src/lib/ip-allowlist";

type Check = {
  name: string;
  ok: boolean;
  message: string;
  level?: "warn" | "error";
};

const envPath = resolve(process.cwd(), process.argv[2] ?? ".env.production");

function parseEnvFile(path: string) {
  return new Map(Object.entries(parseEnv(readFileSync(path, "utf8"))));
}

function isPlaceholder(value: string) {
  const normalized = value.toLowerCase();
  return (
    !value ||
    normalized.includes("replace") ||
    normalized.includes("example") ||
    normalized.includes("please-generate") ||
    normalized === "admin123456"
  );
}

function hasHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function printResult(check: Check) {
  const mark = check.ok ? "OK" : check.level === "warn" ? "WARN" : "FAIL";
  console.log(`${mark} ${check.name}: ${check.message}`);
}

if (!existsSync(envPath)) {
  console.error(`FAIL env file: ${envPath} does not exist`);
  process.exit(1);
}

const env = parseEnvFile(envPath);
const get = (key: string) => env.get(key) ?? "";
const provider = get("RECHARGE_PROVIDER") || "disabled";
const appUrl = get("APP_URL") || get("AUTH_URL") || get("NEXTAUTH_URL");
let adminSeedCheck: Check;
let databasePoolCheck: Check;
let paymentNotifyAllowlistCheck: Check;
try {
  const credentials = resolveAdminSeedCredentials({
    ADMIN_EMAIL: get("ADMIN_EMAIL"),
    ADMIN_PASSWORD: get("ADMIN_PASSWORD"),
    ADMIN_NAME: get("ADMIN_NAME"),
  });
  adminSeedCheck = {
    name: "Admin seed credentials",
    ok: true,
    message: credentials
      ? "configured for explicit administrator seeding"
      : "not stored in the production environment",
  };
} catch (error) {
  adminSeedCheck = {
    name: "Admin seed credentials",
    ok: false,
    message: error instanceof Error ? error.message : "invalid administrator credentials",
  };
}
try {
  isIpAllowed("127.0.0.1", get("LINUX_DO_CREDIT_NOTIFY_IP_ALLOWLIST"));
  paymentNotifyAllowlistCheck = {
    name: "Linux.do Credit callback IP allowlist",
    ok: true,
    message: get("LINUX_DO_CREDIT_NOTIFY_IP_ALLOWLIST")
      ? "configured with valid IP/CIDR entries"
      : "not configured; callback authentication relies on the payment signature",
  };
} catch (error) {
  paymentNotifyAllowlistCheck = {
    name: "Linux.do Credit callback IP allowlist",
    ok: false,
    message:
      error instanceof Error ? error.message : "invalid IP allowlist",
  };
}
try {
  const budget = resolveDatabasePoolBudget(Object.fromEntries(env));
  databasePoolCheck = {
    name: "Database connection budget",
    ok: true,
    message:
      `${budget.total}/${budget.postgresMaxConnections} connections ` +
      `(web ${budget.app}, image worker ${budget.imageWorker}, PPT worker ${budget.pptWorker}, reserve ${budget.reservedConnections}, timeout ${budget.poolTimeoutSeconds}s, source ${budget.source})`,
  };
} catch (error) {
  databasePoolCheck = {
    name: "Database connection budget",
    ok: false,
    message:
      error instanceof Error ? error.message : "invalid database pool settings",
  };
}

const checks: Check[] = [
  {
    name: "DATABASE_URL",
    ok: get("DATABASE_URL").startsWith("postgresql://"),
    message: get("DATABASE_URL").startsWith("postgresql://")
      ? "uses PostgreSQL"
      : "should point to the production PostgreSQL database",
  },
  databasePoolCheck,
  {
    name: "POSTGRES_PASSWORD",
    ok: get("POSTGRES_PASSWORD").length >= 24 && !isPlaceholder(get("POSTGRES_PASSWORD")),
    message: "must be set for the PostgreSQL container",
  },
  {
    name: "REDIS_PASSWORD",
    ok: get("REDIS_PASSWORD").length >= 24 && !isPlaceholder(get("REDIS_PASSWORD")),
    message: "must be set for the Redis container (rate limiting / cache)",
  },
  {
    name: "REDIS_URL",
    ok:
      !get("REDIS_URL") ||
      get("REDIS_URL").startsWith("redis://") ||
      get("REDIS_URL").startsWith("rediss://"),
    message: "when set, must be a redis:// or rediss:// URL (empty uses the compose redis service)",
  },
  {
    name: "AUTH_SECRET",
    ok: get("AUTH_SECRET").length >= 32 && !isPlaceholder(get("AUTH_SECRET")),
    message: "must be a strong production secret",
  },
  {
    name: "ENCRYPTION_KEY",
    ok: /^[a-fA-F0-9]{64}$/.test(get("ENCRYPTION_KEY")),
    message: "must be 64 hex characters and must not change after user keys are stored",
  },
  {
    name: "METRICS_TOKEN",
    ok: get("METRICS_TOKEN").length >= 32 && !isPlaceholder(get("METRICS_TOKEN")),
    message: "must be a strong bearer token for the private metrics endpoint",
  },
  {
    name: "APP_URL",
    ok: hasHttpUrl(appUrl) && appUrl.startsWith("https://"),
    message: "should be the public https domain used by auth and payment callbacks",
  },
  adminSeedCheck,
  {
    name: "Linux.do auth",
    ok: Boolean(get("LINUX_DO_CLIENT_ID") && get("LINUX_DO_CLIENT_SECRET")),
    level: "warn",
    message: "client id and secret should be set before Linux.do-only registration",
  },
  {
    name: "Recharge provider",
    ok: provider === "linuxdo_credit" || provider === "disabled",
    message:
      provider === "linuxdo_credit"
        ? "real Linux.do Credit payment is enabled"
        : provider === "disabled"
          ? "recharge is disabled"
          : "mock recharge must not be enabled in production",
  },
  {
    name: "Linux.do Credit",
    ok:
      provider !== "linuxdo_credit" ||
      Boolean(get("LINUX_DO_CREDIT_PID") && get("LINUX_DO_CREDIT_KEY")),
    message: "pid and key are required when RECHARGE_PROVIDER=linuxdo_credit",
  },
  paymentNotifyAllowlistCheck,
];

for (const check of checks) printResult(check);

const failures = checks.filter((check) => !check.ok && check.level !== "warn");
if (failures.length > 0) {
  console.error(`\n${failures.length} blocking production env check(s) failed.`);
  process.exit(1);
}

const warnings = checks.filter((check) => !check.ok && check.level === "warn");
if (warnings.length > 0) {
  console.warn(`\n${warnings.length} production warning(s) need an explicit launch decision.`);
}
