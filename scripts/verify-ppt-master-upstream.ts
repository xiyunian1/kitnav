import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface UpstreamManifest {
  repository: string;
  ref: string;
  commit: string;
  skillPath: string;
  treeSha: string;
  executableFiles?: string[];
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repositoryRoot, "scripts", "ppt-master.upstream.json");
const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as UpstreamManifest;
const skillDirectory = join(repositoryRoot, "scripts", "ppt-master");
const executableFiles = new Set(manifest.executableFiles || []);
const skillTree = hashDirectory(skillDirectory).toString("hex");

if (skillTree !== manifest.treeSha) {
  throw new Error(
    [
      "PPT Master vendor verification failed.",
      `Expected ${manifest.ref} tree ${manifest.treeSha}.`,
      `Found local tree ${skillTree}.`,
      "Keep hosted customizations outside scripts/ppt-master, then resync the pinned upstream skill.",
    ].join("\n"),
  );
}

console.log(
  `PPT Master ${manifest.ref} verified (${manifest.commit.slice(0, 12)}, tree ${skillTree}).`,
);

function hashDirectory(directory: string, relativeDirectory = ""): Buffer {
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !isGeneratedArtifact(entry.name))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.isDirectory() ? `${left.name}/` : left.name),
        Buffer.from(right.isDirectory() ? `${right.name}/` : right.name),
      ),
    );
  const treeEntries: Buffer[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const stats = lstatSync(absolutePath);
    let mode: string;
    let hash: Buffer;

    if (stats.isDirectory()) {
      mode = "40000";
      hash = hashDirectory(absolutePath, relativePath);
    } else if (stats.isSymbolicLink()) {
      mode = "120000";
      hash = hashObject("blob", Buffer.from(readlinkSync(absolutePath)));
    } else {
      mode = executableFiles.has(relativePath) ? "100755" : "100644";
      hash = hashObject("blob", readFileSync(absolutePath));
    }

    treeEntries.push(
      Buffer.concat([
        Buffer.from(`${mode} ${entry.name}\0`),
        hash,
      ]),
    );
  }

  return hashObject("tree", Buffer.concat(treeEntries));
}

function hashObject(type: "blob" | "tree", content: Buffer) {
  return createHash("sha1")
    .update(Buffer.from(`${type} ${content.length}\0`))
    .update(content)
    .digest();
}

function isGeneratedArtifact(name: string) {
  return (
    name === "__pycache__" ||
    name === ".DS_Store" ||
    name.startsWith("._") ||
    name.endsWith(".pyc")
  );
}
