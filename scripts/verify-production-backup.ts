import {
  assertSafeArchiveEntryTypes,
  assertSafeArchiveEntries,
  verifyBackupSnapshot,
} from "./backup-snapshot-utils";
import { runBoundedProcess } from "../src/lib/ppt-agent/bounded-process";

function readSnapshotArg() {
  const inline = process.argv.find((arg) => arg.startsWith("--snapshot="));
  if (inline) return inline.slice("--snapshot=".length);
  const index = process.argv.indexOf("--snapshot");
  return index >= 0 ? process.argv[index + 1] : process.argv[2];
}

async function runCapture(command: string, args: string[]) {
  const result = await runBoundedProcess(command, args, {
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
    outputLimitError: () =>
      new Error(`${command} output exceeds the 64 MiB verification limit`),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} exited with ${result.exitCode ?? `signal ${result.signal ?? "unknown"}`}: ${result.stderr.slice(-4_000)}`,
    );
  }
  return result.stdout;
}

async function main() {
  const snapshot = readSnapshotArg();
  if (!snapshot) throw new Error("Usage: --snapshot <snapshot-directory>");
  const verified = await verifyBackupSnapshot(snapshot);
  await runCapture("docker", [
    "run",
    "--rm",
    "-v",
    `${verified.root}:/backup:ro`,
    process.env.BACKUP_POSTGRES_IMAGE ||
      "postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777",
    "pg_restore",
    "--list",
    "/backup/database.dump",
  ]);
  if (verified.manifest.files.included.length > 0) {
    const listing = await runCapture("tar", [
      "--quoting-style=literal",
      "-tzf",
      verified.filesPath,
    ]);
    assertSafeArchiveEntries(listing, verified.manifest.files.included);
    assertSafeArchiveEntryTypes(
      await runCapture("tar", [
        "--quoting-style=literal",
        "-tvzf",
        verified.filesPath,
      ]),
    );
  }
  console.log(`Backup snapshot verified: ${verified.root}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
