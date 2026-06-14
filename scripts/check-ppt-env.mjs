#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const skillDir = join(root, "scripts", "ppt-master");

let hasError = false;

function ok(message) {
  console.log(`OK  ${message}`);
}

function fail(message) {
  console.log(`ERR ${message}`);
  hasError = true;
}

console.log("PPT environment check\n");

try {
  const version = execFileSync(process.platform === "win32" ? "python" : "python3", ["--version"], {
    encoding: "utf8",
  }).trim();
  ok(version);
} catch {
  fail("Python is not available in PATH.");
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
  const binary = resolveWindowsShim(process.env.PPT_AGENT_BINARY || process.env.PPT_AGENT_COMMAND || "claude");
  const version = execAgentVersion(binary);
  ok(`PPT CLI agent available: ${binary} ${version}`);
} catch {
  fail("PPT CLI agent is not available. Install/login Claude Code CLI or set PPT_AGENT_COMMAND.");
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
