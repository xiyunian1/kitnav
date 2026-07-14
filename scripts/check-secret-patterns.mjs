import { lstat, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..");
const maxFileBytes = 2 * 1024 * 1024;
const findings = [];

const tokenRules = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: "GitHub token",
    pattern: /\bgh[oprsu]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    name: "provider API key",
    pattern: /\b(?:sk|rk)-(?!\.\.\.)[A-Za-z0-9_-]{20,}\b/g,
  },
];

const credentialAssignment =
  /\b(?:[A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|API_KEY|APIKEY|SECRET|TOKEN)|password|passwd|pwd|apiKey|secret|token)\b\s*(?:=|:)\s*["'`]([^"'`\r\n]{8,})["'`]/gi;

function lineNumber(content, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function isFixture(file) {
  return (
    /(?:^|\/)scripts\/check-[^/]+$/.test(file) ||
    /(?:^|\/)scripts\/test-fixtures\//.test(file) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /\.example$/.test(file)
  );
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("placeholder") ||
    normalized.includes("replace") ||
    normalized.includes("example") ||
    normalized.includes("generate") ||
    normalized.includes("dummy") ||
    normalized.includes("mock") ||
    normalized.includes("test-only") ||
    value.startsWith("$") ||
    value.includes("${") ||
    value.includes("<")
  );
}

function scanContent(file, content) {
  for (const rule of tokenRules) {
    rule.pattern.lastIndex = 0;
    for (const match of content.matchAll(rule.pattern)) {
      findings.push({ file, line: lineNumber(content, match.index), rule: rule.name });
    }
  }

  if (isFixture(file)) return;
  credentialAssignment.lastIndex = 0;
  for (const match of content.matchAll(credentialAssignment)) {
    if (isPlaceholder(match[1])) continue;
    findings.push({
      file,
      line: lineNumber(content, match.index),
      rule: "hard-coded credential",
    });
  }
}

function repositoryFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repoDir, encoding: "buffer" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.toString("utf8") || "git ls-files failed");
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.startsWith("scripts/ppt-master/"));
}

for (const file of repositoryFiles()) {
  const absolute = path.join(repoDir, file);
  let metadata;
  try {
    metadata = await lstat(absolute);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") continue;
    throw error;
  }
  if (!metadata.isFile() || metadata.size > maxFileBytes) continue;

  const content = await readFile(absolute, "utf8");
  if (content.includes("\0")) continue;
  scanContent(file, content);
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: possible ${finding.rule}`);
  }
  console.error("Secret scan failed; values are intentionally redacted.");
  process.exitCode = 1;
} else {
  console.log("High-confidence secret patterns are absent from repository files.");
}
