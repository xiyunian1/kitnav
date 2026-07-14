import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertSafeArchiveEntryTypes,
  assertSafeArchiveEntries,
  verifyBackupSnapshot,
} from "./backup-snapshot-utils";
import {
  composeCommandArgs,
  resolveComposeEnvFile,
} from "./compose-cli-utils";
import { runBoundedProcess } from "../src/lib/ppt-agent/bounded-process";

function argsMap() {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item?.startsWith("--")) continue;
    const [key, inline] = item.slice(2).split("=", 2);
    const value = inline ?? process.argv[index + 1];
    if (!value || (inline === undefined && value.startsWith("--"))) {
      throw new Error(`Missing value for --${key}`);
    }
    if (inline === undefined) index += 1;
    args.set(key, value);
  }
  return args;
}

function run(command: string, args: string[], stdinPath?: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: [stdinPath ? "pipe" : "ignore", "inherit", "inherit"],
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolvePromise();
    };
    if (stdinPath) {
      if (!child.stdin) {
        child.kill();
        finish(new Error("Restore process stdin is unavailable"));
        return;
      }
      const input = createReadStream(stdinPath);
      input.once("error", (error) => {
        child.kill();
        finish(error);
      });
      child.stdin.once("error", (error) => {
        child.kill();
        finish(error);
      });
      input.pipe(child.stdin);
    }
    child.once("error", finish);
    child.once("close", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
          ),
        );
      }
    });
  });
}

async function runCapture(command: string, args: string[]) {
  const result = await runBoundedProcess(command, args, {
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
    outputLimitError: () =>
      new Error(`${command} output exceeds the 64 MiB restore limit`),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} exited with ${result.exitCode ?? `signal ${result.signal ?? "unknown"}`}: ${result.stderr.slice(-4_000)}`,
    );
  }
  return result.stdout;
}

async function main() {
  const args = argsMap();
  const snapshot = args.get("snapshot");
  if (!snapshot) throw new Error("--snapshot is required");
  const verified = await verifyBackupSnapshot(snapshot);
  const project = args.get("compose-project") || "ai-aggregator";
  const composeFile = resolve(args.get("compose-file") || "docker-compose.yml");
  const composeEnvFile = resolveComposeEnvFile(args.get("env-file"));
  const service = args.get("postgres-service") || "postgres";
  const user = args.get("postgres-user") || "ai_aggregator";
  const database = `restore_drill_${Date.now()}`;
  const extracted = await mkdtemp(join(tmpdir(), "backup-restore-drill-"));
  const compose = (command: string[]) =>
    composeCommandArgs({
      project,
      composeFile,
      envFile: composeEnvFile,
      service,
      command,
    });

  try {
    await run("docker", compose(["createdb", "-U", user, database]));
    await run(
      "docker",
      compose([
        "pg_restore",
        "-U",
        user,
        "-d",
        database,
        "--no-owner",
        "--no-privileges",
      ]),
      verified.databasePath,
    );
    const tableCount = Number(
      (
        await runCapture(
          "docker",
          compose([
            "psql",
            "-U",
            user,
            "-d",
            database,
            "-At",
            "-c",
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';",
          ]),
        )
      ).trim(),
    );
    if (!Number.isSafeInteger(tableCount) || tableCount < 1) {
      throw new Error("Restored database contains no public tables");
    }

    if (verified.manifest.files.included.length > 0) {
      const listing = await runCapture("tar", ["-tzf", verified.filesPath]);
      assertSafeArchiveEntries(listing, verified.manifest.files.included);
      assertSafeArchiveEntryTypes(
        await runCapture("tar", ["-tvzf", verified.filesPath]),
      );
      await run("tar", ["-xzf", verified.filesPath, "-C", extracted]);
      for (const path of verified.manifest.files.included) {
        if (!(await stat(join(extracted, path))).isDirectory()) {
          throw new Error(`Restored file path is missing: ${path}`);
        }
      }
    }
    console.log(
      `Restore drill passed: ${tableCount} tables and ${verified.manifest.files.included.length} file roots`,
    );
  } finally {
    await run("docker", compose(["dropdb", "-U", user, "--if-exists", database])).catch(
      () => undefined,
    );
    await rm(extracted, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
