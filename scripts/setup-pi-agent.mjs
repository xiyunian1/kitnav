#!/usr/bin/env node

import crypto from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const args = new Set(process.argv.slice(2));
const fromPlatform = args.has("--from-platform");

const agentDir = process.env.PI_CODING_AGENT_DIR || join(process.cwd(), "data", "pi-agent");
const provider = process.env.PPT_PI_PROVIDER || "ppt-platform";

const explicit = {
  provider,
  baseUrl: process.env.PPT_PI_BASE_URL,
  apiKey: process.env.PPT_PI_API_KEY,
  model: process.env.PPT_PI_MODEL || process.env.PPT_AGENT_MODEL,
};

const config = await resolveConfig();
const thinkingLevel = resolvePiThinkingLevel(config.modelOptions);

mkdirSync(agentDir, { recursive: true });

writeFileSync(
  join(agentDir, "settings.json"),
  `${JSON.stringify(
    {
      defaultProvider: config.provider,
      defaultModel: config.model,
      defaultThinkingLevel: thinkingLevel,
      packages: [],
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);

writeFileSync(
  join(agentDir, "models.json"),
  `${JSON.stringify(
    {
      providers: {
        [config.provider]: {
          name: "PPT Platform",
          baseUrl: config.baseUrl,
          apiKey: "$PPT_PI_API_KEY",
          api: process.env.PPT_PI_API_TYPE || "openai-completions",
          headers: buildPiProviderHeaders(),
          compat: buildOpenAiCompatibleCompat(),
          models: [
            {
              id: config.model,
              name: config.model,
              reasoning: resolvePiReasoningEnabled(),
              input: ["text"],
              contextWindow: numberEnv("PPT_PI_CONTEXT_WINDOW", 128000),
              maxTokens: numberEnv("PPT_PI_MAX_TOKENS", 16384),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              thinkingLevelMap: buildThinkingLevelMap(),
            },
          ],
        },
      },
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);

writeFileSync(
  join(agentDir, "auth.json"),
  `${JSON.stringify(
    {
      [config.provider]: {
        type: "api_key",
        key: "$PPT_PI_API_KEY",
        env: {
          PPT_PI_API_KEY: config.apiKey,
        },
      },
    },
    null,
    2,
  )}\n`,
  { encoding: "utf8", mode: 0o600 },
);

writeFileSync(
  join(agentDir, "env.sh"),
  `export PPT_PI_PROVIDER=${shellQuote(config.provider)}\nexport PPT_PI_MODEL=${shellQuote(config.model)}\n`,
  { encoding: "utf8", mode: 0o600 },
);

console.log(`Prepared pi agent config: ${config.provider}/${config.model}`);

async function resolveConfig() {
  if (explicit.baseUrl && explicit.apiKey && explicit.model) {
    return explicit;
  }

  if (!fromPlatform) {
    throw new Error(
      "Missing PPT_PI_BASE_URL, PPT_PI_API_KEY or PPT_PI_MODEL for pi agent.",
    );
  }

  const prisma = new PrismaClient();
  try {
    const platform = await prisma.providerConfig.findUnique({
      where: { module: "PPT" },
      select: { baseUrl: true, apiKey: true, model: true, modelOptions: true },
    });

    if (!platform?.baseUrl || !platform.apiKey || !platform.model) {
      throw new Error("Platform PPT provider config is incomplete.");
    }

    return {
      provider,
      baseUrl: platform.baseUrl,
      apiKey: decrypt(platform.apiKey),
      model: process.env.PPT_PI_MODEL || process.env.PPT_AGENT_MODEL || platform.model,
      modelOptions: platform.modelOptions,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function decrypt(stored) {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error("ENCRYPTION_KEY is required to decrypt platform PPT provider key.");
  }

  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Encrypted platform PPT provider key has invalid format.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(keyHex, "hex"),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function resolvePiThinkingLevel(modelOptions) {
  return normalizeThinkingLevel(
    process.env.PPT_PI_THINKING?.trim() || parsePptModelOptions(modelOptions).thinkingLevel,
  );
}

function resolvePiReasoningEnabled() {
  return isTruthy(process.env.PPT_PI_REASONING ?? "true");
}

function parsePptModelOptions(value) {
  if (!value) return { thinkingLevel: "medium" };
  try {
    const parsed = JSON.parse(value);
    return { thinkingLevel: normalizeThinkingLevel(parsed?.thinkingLevel) };
  } catch {
    return { thinkingLevel: "medium" };
  }
}

function normalizeThinkingLevel(value) {
  return ["low", "medium", "high", "xhigh"].includes(value) ? value : "medium";
}

function buildPiProviderHeaders() {
  return {
    "User-Agent": process.env.PPT_PI_USER_AGENT?.trim() || "node",
  };
}

function buildOpenAiCompatibleCompat() {
  return {
    supportsStore: isTruthy(process.env.PPT_PI_SUPPORTS_STORE ?? "false"),
    supportsDeveloperRole: isTruthy(
      process.env.PPT_PI_SUPPORTS_DEVELOPER_ROLE ?? "false",
    ),
    supportsReasoningEffort: isTruthy(
      process.env.PPT_PI_SUPPORTS_REASONING_EFFORT ?? "false",
    ),
    supportsUsageInStreaming: isTruthy(
      process.env.PPT_PI_SUPPORTS_USAGE_IN_STREAMING ?? "false",
    ),
    maxTokensField:
      process.env.PPT_PI_MAX_TOKENS_FIELD === "max_completion_tokens"
        ? "max_completion_tokens"
        : "max_tokens",
  };
}

function buildThinkingLevelMap() {
  return {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: process.env.PPT_PI_THINKING_VALUE || "max",
  };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
