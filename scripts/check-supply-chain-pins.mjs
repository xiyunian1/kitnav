import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoDir = path.resolve(import.meta.dirname, "..");
const digestPattern = /@sha256:[0-9a-f]{64}$/;
const actionCommitPattern = /^[^\s@]+\/[^\s@]+@[0-9a-f]{40}$/;
const failures = [];

async function readRepoFile(file) {
  return readFile(path.join(repoDir, file), "utf8");
}

function report(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

async function checkDockerfile() {
  const file = "Dockerfile";
  const lines = (await readRepoFile(file)).split(/\r?\n/);
  const stages = new Set();

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i);
    if (!match) continue;

    const [, image, stage] = match;
    if (!stages.has(image) && !digestPattern.test(image)) {
      report(file, index + 1, `external base image is not pinned by digest: ${image}`);
    }
    if (stage) stages.add(stage);
  }
}

async function workflowFiles() {
  const directory = path.join(repoDir, ".github", "workflows");
  return (await readdir(directory))
    .filter((file) => /\.ya?ml$/i.test(file))
    .map((file) => path.join(".github", "workflows", file));
}

async function checkWorkflows() {
  for (const file of await workflowFiles()) {
    const lines = (await readRepoFile(file)).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/);
      if (!match || match[1].startsWith("./")) continue;
      if (!actionCommitPattern.test(match[1])) {
        report(file, index + 1, `remote action is not pinned to a full commit: ${match[1]}`);
      }
    }
  }
}

async function checkYamlImages() {
  const files = [
    "docker-compose.yml",
    "scripts/test-fixtures/postgres-compose.yml",
    ...(await workflowFiles()),
  ];

  for (const file of files) {
    const lines = (await readRepoFile(file)).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*image:\s*([^\s#]+)/);
      if (!match) continue;

      const image = match[1];
      const isLocalBuild = /^ai-aggregator-[\w-]+:local$/.test(image);
      if (!isLocalBuild && !digestPattern.test(image)) {
        report(file, index + 1, `external service image is not pinned by digest: ${image}`);
      }
    }
  }
}

async function checkKnownCommandImages() {
  const files = [
    ".github/workflows/ci.yml",
    "scripts/check-production-images-runtime.sh",
    "scripts/compile-ppt-requirements.sh",
    "scripts/verify-production-backup.ts",
  ];
  const imagePattern =
    /(?:^|[\s"'=])((?:caddy|node|postgres|python):\d+(?:\.\d+)*(?:-[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?)/g;

  for (const file of files) {
    const lines = (await readRepoFile(file)).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const match of line.matchAll(imagePattern)) {
        const image = match[1];
        if (!digestPattern.test(image)) {
          report(file, index + 1, `command image is not pinned by digest: ${image}`);
        }
      }
    }
  }
}

async function checkPiAgentRuntimeLock() {
  const manifestFile = "scripts/pi-agent-runtime/package.json";
  const lockFile = "scripts/pi-agent-runtime/package-lock.json";
  const manifest = JSON.parse(await readRepoFile(manifestFile));
  const lock = JSON.parse(await readRepoFile(lockFile));
  const dependency = "@earendil-works/pi-coding-agent";
  const requestedVersion = manifest.dependencies?.[dependency];
  const lockedVersion = lock.packages?.[`node_modules/${dependency}`]?.version;
  const rootVersion = lock.packages?.[""]?.dependencies?.[dependency];

  if (!/^\d+\.\d+\.\d+$/.test(requestedVersion ?? "")) {
    report(manifestFile, 1, `${dependency} must use an exact version`);
  }
  if (lockedVersion !== requestedVersion || rootVersion !== requestedVersion) {
    report(lockFile, 1, `${dependency} lock does not match package.json`);
  }

  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!packagePath || !metadata.resolved || metadata.link) continue;
    if (!metadata.integrity) {
      report(lockFile, 1, `registry package is missing integrity: ${packagePath}`);
    }
  }
}

await checkDockerfile();
await checkWorkflows();
await checkYamlImages();
await checkKnownCommandImages();
await checkPiAgentRuntimeLock();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Supply-chain image, action, and Pi runtime pins are valid.");
}
