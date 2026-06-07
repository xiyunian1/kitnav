import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

type Check = {
  name: string;
  ok: boolean;
  message: string;
  level?: "warn" | "error";
};

const envPath = resolve(process.cwd(), process.argv[2] ?? ".env.production");

function parseEnvFile(path: string) {
  const values = new Map<string, string>();
  const content = readFileSync(path, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }

  return values;
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
const provider = get("RECHARGE_PROVIDER") || "mock";
const appUrl = get("APP_URL") || get("AUTH_URL") || get("NEXTAUTH_URL");

const checks: Check[] = [
  {
    name: "DATABASE_URL",
    ok: get("DATABASE_URL").startsWith("postgresql://"),
    message: get("DATABASE_URL").startsWith("postgresql://")
      ? "uses PostgreSQL"
      : "should point to the production PostgreSQL database",
  },
  {
    name: "POSTGRES_PASSWORD",
    ok: get("POSTGRES_PASSWORD").length >= 24 && !isPlaceholder(get("POSTGRES_PASSWORD")),
    message: "must be set for the PostgreSQL container",
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
    name: "APP_URL",
    ok: hasHttpUrl(appUrl) && appUrl.startsWith("https://"),
    message: "should be the public https domain used by auth and payment callbacks",
  },
  {
    name: "ADMIN_PASSWORD",
    ok: !isPlaceholder(get("ADMIN_PASSWORD")) && get("ADMIN_PASSWORD").length >= 12,
    message: "must not use the default admin password",
  },
  {
    name: "Linux.do auth",
    ok: Boolean(get("LINUX_DO_CLIENT_ID") && get("LINUX_DO_CLIENT_SECRET")),
    level: "warn",
    message: "client id and secret should be set before Linux.do-only registration",
  },
  {
    name: "Recharge provider",
    ok: provider === "linuxdo_credit",
    level: "warn",
    message:
      provider === "linuxdo_credit"
        ? "real Linux.do Credit payment is enabled"
        : "mock recharge is enabled; disable recharge or switch to linuxdo_credit before paid launch",
  },
  {
    name: "Linux.do Credit",
    ok:
      provider !== "linuxdo_credit" ||
      Boolean(get("LINUX_DO_CREDIT_PID") && get("LINUX_DO_CREDIT_KEY")),
    message: "pid and key are required when RECHARGE_PROVIDER=linuxdo_credit",
  },
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
