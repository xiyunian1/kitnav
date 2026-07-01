#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const skillDir = join(root, "scripts", "ppt-master");

loadDotEnv(join(root, ".env"));
loadDotEnv(join(root, ".env.local"));

let hasError = false;

function ok(message) {
  console.log(`OK  ${message}`);
}

function fail(message) {
  console.log(`ERR ${message}`);
  hasError = true;
}

console.log("PPT environment check\n");

const pythonCmd = process.env.PPT_PYTHON_CMD?.trim() || (process.platform === "win32" ? "python" : "python3");
try {
  const version = execFileSync(pythonCmd, ["--version"], {
    encoding: "utf8",
  }).trim();
  ok(`${pythonCmd} ${version}`);
  const match = version.match(/Python\s+(\d+)\.(\d+)/);
  const major = Number(match?.[1] || 0);
  const minor = Number(match?.[2] || 0);
  if (major < 3 || (major === 3 && minor < 10)) {
    fail("PPT Master Python tools require Python 3.10+; set PPT_PYTHON_CMD to a newer Python.");
  }
} catch {
  fail(`Python is not available: ${pythonCmd}`);
}

for (const file of [
  "SKILL.md",
  "workflows/resume-execute.md",
  "references/strategist.md",
  "references/executor-base.md",
  "references/shared-standards.md",
  "templates/design_spec_reference.md",
  "scripts/svg_to_pptx.py",
]) {
  const path = join(skillDir, file);
  if (existsSync(path)) ok(file);
  else fail(`${file} is missing under ${skillDir}`);
}

if (existsSync(join(root, "data", "ppt-projects"))) ok("data/ppt-projects exists");
else fail("data/ppt-projects does not exist.");

try {
  const binary = resolveWindowsShim("pi");
  const version = execAgentVersion(binary);
  ok(`PPT pi agent available: ${binary} ${version}`);
  checkPiModel(binary);
} catch (error) {
  fail(
    `PPT pi agent is not available or not configured: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (hasError) {
  console.log("\nPPT environment check failed.");
  process.exit(1);
}

console.log("\nPPT environment check passed.");

function execAgentVersion(binary) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(binary)) {
    return execFileSync("cmd.exe", ["/d", "/s", "/c", binary, "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  return execFileSync(binary, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function checkPiModel(binary) {
  const provider = process.env.PPT_PI_PROVIDER?.trim();
  const model = process.env.PPT_PI_MODEL?.trim() || process.env.PPT_AGENT_MODEL?.trim();
  const args = ["--list-models", model || provider || ""].filter(Boolean);
  const output = execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (provider && model && !(output.includes(provider) && output.includes(model))) {
    fail(`pi model not found: ${provider}/${model}`);
    return;
  }
  ok(model || provider ? `pi model lookup ok: ${provider ? `${provider}/` : ""}${model || "*"}` : "pi model lookup ok");
}

function resolveWindowsShim(binary) {
  if (process.platform !== "win32" || /[\\/]/.test(binary) || /\.[a-z0-9]+$/i.test(binary)) {
    return binary;
  }
  try {
    return execFileSync("where.exe", [binary], { encoding: "utf8" })
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.toLowerCase().endsWith(".cmd")) || binary;
  } catch {
    return binary;
  }
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
