import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { terminateProcessTree } from "../src/lib/ppt-agent/bounded-process";

const SNAPSHOT_PATHS = new Set([
  "uploads",
  "image-inputs",
  "ppt-uploads",
  "ppt-projects",
]);
const MAX_BACKUP_MANIFEST_BYTES = 64 * 1024;
const ARCHIVE_VALIDATION_TIMEOUT_MS = 10 * 60_000;
const MAX_ARCHIVE_STDERR_BYTES = 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024;

export interface BackupManifest {
  version: 2;
  createdAt: string;
  postgres: {
    database: string;
    service: string;
    format: "custom";
    bytes: number;
    sha256: string;
  };
  files: {
    included: string[];
    bytes: number;
    sha256: string | null;
  };
}

async function sha256File(path: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(path);
    input.once("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.once("end", () => resolvePromise(hash.digest("hex")));
  });
}

function assertManifest(value: unknown): asserts value is BackupManifest {
  const manifest = value as Partial<BackupManifest> | null;
  if (
    !manifest ||
    manifest.version !== 2 ||
    typeof manifest.createdAt !== "string" ||
    Number.isNaN(new Date(manifest.createdAt).getTime()) ||
    manifest.postgres?.format !== "custom" ||
    typeof manifest.postgres.database !== "string" ||
    typeof manifest.postgres.service !== "string" ||
    !Number.isSafeInteger(manifest.postgres.bytes) ||
    manifest.postgres.bytes! <= 0 ||
    !/^[0-9a-f]{64}$/.test(manifest.postgres.sha256 ?? "") ||
    !Array.isArray(manifest.files?.included) ||
    !manifest.files.included.every((path) => SNAPSHOT_PATHS.has(path)) ||
    !Number.isSafeInteger(manifest.files.bytes) ||
    manifest.files.bytes! < 0 ||
    !(
      manifest.files.sha256 === null ||
      /^[0-9a-f]{64}$/.test(manifest.files.sha256 ?? "")
    )
  ) {
    throw new Error("Backup manifest is invalid or unsupported");
  }
  if (
    (manifest.files.included.length === 0) !==
    (manifest.files.bytes === 0 && manifest.files.sha256 === null)
  ) {
    throw new Error("Backup file archive metadata is inconsistent");
  }
}

async function assertFile(path: string, bytes: number, sha256: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== bytes) {
    throw new Error(`Backup file size mismatch: ${path}`);
  }
  if ((await sha256File(path)) !== sha256) {
    throw new Error(`Backup file checksum mismatch: ${path}`);
  }
}

export async function verifyBackupSnapshot(snapshotDir: string) {
  const root = resolve(snapshotDir);
  const manifestPath = join(root, "manifest.json");
  const manifestInfo = await stat(manifestPath);
  if (!manifestInfo.isFile() || manifestInfo.size > MAX_BACKUP_MANIFEST_BYTES) {
    throw new Error("Backup manifest is invalid or too large");
  }
  const raw = JSON.parse(await readFile(manifestPath, "utf8"));
  assertManifest(raw);
  const manifest = raw;
  const databasePath = join(root, "database.dump");
  await assertFile(
    databasePath,
    manifest.postgres.bytes,
    manifest.postgres.sha256,
  );
  const database = await open(databasePath, "r");
  try {
    const magic = Buffer.alloc(5);
    const { bytesRead } = await database.read(magic, 0, magic.length, 0);
    if (bytesRead !== 5 || magic.toString("ascii") !== "PGDMP") {
      throw new Error("PostgreSQL backup does not have the PGDMP signature");
    }
  } finally {
    await database.close();
  }

  const filesPath = join(root, "files.tar.gz");
  if (manifest.files.sha256) {
    await assertFile(filesPath, manifest.files.bytes, manifest.files.sha256);
  }
  return { root, manifest, databasePath, filesPath };
}

export function assertSafeArchiveEntries(
  listing: string,
  includedPaths: string[],
) {
  const allowed = new Set(includedPaths);
  for (const raw of listing.split("\n")) {
    assertSafeArchiveEntry(raw, allowed);
  }
}

export function assertSafeArchiveEntryTypes(verboseListing: string) {
  for (const line of verboseListing.split("\n")) {
    assertSafeArchiveEntryType(line);
  }
}

function assertSafeArchiveEntry(raw: string, allowed: Set<string>) {
  if (Buffer.byteLength(raw) > MAX_ARCHIVE_ENTRY_BYTES) {
    throw new Error("Backup archive entry name is too large");
  }
  const entry = raw.trim().replace(/^\.\//, "");
  if (!entry) return;
  if (entry.startsWith("/") || entry.includes("\\")) {
    throw new Error(`Unsafe backup archive entry: ${entry}`);
  }
  const parts = entry.split("/").filter(Boolean);
  if (parts.includes("..") || parts.includes(".")) {
    throw new Error(`Unsafe backup archive entry: ${entry}`);
  }
  if (!parts[0] || !allowed.has(parts[0])) {
    throw new Error(`Unexpected backup archive entry: ${entry}`);
  }
}

function assertSafeArchiveEntryType(line: string) {
  if (!line.trim()) return;
  const type = line[0];
  if (type !== "-" && type !== "d") {
    throw new Error("Backup archive contains a link or special file");
  }
}

function inspectArchiveListing(
  filesPath: string,
  verbose: boolean,
  inspectLine: (line: string) => void,
) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "tar",
      [
        "--quoting-style=literal",
        verbose ? "-tvzf" : "-tzf",
        filesPath,
      ],
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const lines = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      lines.close();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolvePromise();
    };
    const stop = (error: Error) => {
      terminateProcessTree(child);
      child.stdout.destroy();
      child.stderr.destroy();
      finish(error);
    };
    const timer = setTimeout(() => {
      stop(new Error("Backup archive validation timed out"));
    }, ARCHIVE_VALIDATION_TIMEOUT_MS);

    lines.on("line", (line) => {
      if (settled) return;
      try {
        inspectLine(line);
      } catch (error) {
        stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += buffer.length;
      if (stderrBytes > MAX_ARCHIVE_STDERR_BYTES) {
        stop(new Error("tar stderr exceeds the 1 MiB validation limit"));
        return;
      }
      stderr.push(buffer);
    });
    child.once("error", finish);
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      if (exitCode !== 0) {
        finish(
          new Error(
            `tar exited with ${exitCode ?? `signal ${signal ?? "unknown"}`}: ${Buffer.concat(stderr).toString("utf8").slice(-4_000)}`,
          ),
        );
        return;
      }
      finish();
    });
  });
}

export async function validateBackupFileArchive(
  filesPath: string,
  includedPaths: string[],
) {
  const allowed = new Set(includedPaths);
  await inspectArchiveListing(filesPath, false, (line) =>
    assertSafeArchiveEntry(line, allowed),
  );
  await inspectArchiveListing(filesPath, true, assertSafeArchiveEntryType);
}
