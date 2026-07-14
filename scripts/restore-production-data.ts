import { createReadStream } from "node:fs";
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import {
  assertSafeArchiveEntryTypes,
  assertSafeArchiveEntries,
  verifyBackupSnapshot,
} from "./backup-snapshot-utils";
import {
  activateRestoredFileRoots,
  activateStagingDatabase,
  rollbackRestoredFileRoots,
  type ActivatedFileRoot,
} from "./restore-cutover-utils";
import {
  composeCommandArgs,
  resolveComposeEnvFile,
} from "./compose-cli-utils";
import { runBoundedProcess } from "../src/lib/ppt-agent/bounded-process";

function readArgs() {
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
      child.stdin.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE") return;
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

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function safeDatabaseName(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value)) {
    throw new Error(
      "--target-database must start with a letter and contain only letters, numbers, or underscores",
    );
  }
  return value;
}

async function main() {
  const args = readArgs();
  const snapshot = args.get("snapshot");
  if (!snapshot) throw new Error("--snapshot is required");
  const targetDatabase = safeDatabaseName(
    args.get("target-database") || "ai_aggregator",
  );
  if (args.get("confirm") !== `RESTORE:${targetDatabase}`) {
    throw new Error(`Pass --confirm RESTORE:${targetDatabase} to authorize restore`);
  }

  const verified = await verifyBackupSnapshot(snapshot);
  const composeFile = resolve(args.get("compose-file") || "docker-compose.yml");
  const composeEnvFile = resolveComposeEnvFile(args.get("env-file"));
  const project = args.get("compose-project") || "ai-aggregator";
  const postgresService = args.get("postgres-service") || "postgres";
  const postgresUser = args.get("postgres-user") || "ai_aggregator";
  const dataDir = resolve(args.get("data-dir") || "data");
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const restoreSuffix = `_restore_${stamp}`;
  const previousSuffix = `_pre_${stamp}`;
  const stagingDatabase = `${targetDatabase.slice(0, 63 - restoreSuffix.length)}${restoreSuffix}`;
  const previousDatabase = `${targetDatabase.slice(0, 63 - previousSuffix.length)}${previousSuffix}`;
  const compose = (command: string[], service = postgresService) =>
    composeCommandArgs({
      project,
      composeFile,
      envFile: composeEnvFile,
      service,
      command,
    });

  const runningServices = (
    await runCapture(
      "docker",
      composeCommandArgs({
        project,
        composeFile,
        envFile: composeEnvFile,
        command: ["ps", "--status", "running", "--services"],
      }),
    )
  )
    .split("\n")
    .map((service) => service.trim())
    .filter(Boolean);
  const unsafeServices = runningServices.filter((service) =>
    ["app", "ppt-worker", "image-worker"].includes(service),
  );
  if (unsafeServices.length > 0) {
    throw new Error(
      `Stop application workers before restore: ${unsafeServices.join(", ")}`,
    );
  }

  const fileStaging = await mkdtemp(
    join(dirname(dataDir), ".ai-aggregator-restore-"),
  );
  let stagingDatabaseCreated = false;
  let databaseActivated = false;
  let activatedFiles: ActivatedFileRoot[] = [];
  try {
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
      await run("tar", ["-xzf", verified.filesPath, "-C", fileStaging]);
      for (const path of verified.manifest.files.included) {
        if (!(await stat(join(fileStaging, path))).isDirectory()) {
          throw new Error(`Restored file root is invalid: ${path}`);
        }
      }
    }

    await run("docker", compose(["createdb", "-U", postgresUser, stagingDatabase]));
    stagingDatabaseCreated = true;
    await run(
      "docker",
      compose([
        "pg_restore",
        "-U",
        postgresUser,
        "-d",
        stagingDatabase,
        "--no-owner",
        "--no-privileges",
      ]),
      verified.databasePath,
    );

    const targetExists =
      (
        await runCapture(
          "docker",
          compose([
            "psql",
            "-U",
            postgresUser,
            "-d",
            "postgres",
            "-At",
            "-c",
            `SELECT 1 FROM pg_database WHERE datname = '${targetDatabase}';`,
          ]),
        )
      ).trim() === "1";
    if (targetExists && args.get("replace-database") !== "true") {
      throw new Error(
        "Target database exists; pass --replace-database true after stopping services",
      );
    }
    for (const path of verified.manifest.files.included) {
      const destination = join(dataDir, path);
      if ((await exists(destination)) && args.get("replace-files") !== "true") {
        throw new Error(
          `Target file root exists: ${destination}; pass --replace-files true`,
        );
      }
    }

    activatedFiles = await activateRestoredFileRoots({
      includedPaths: verified.manifest.files.included,
      stagingDir: fileStaging,
      dataDir,
      stamp,
    });

    await activateStagingDatabase({
      targetExists,
      renameTargetToPrevious: () =>
        run(
          "docker",
          compose([
            "psql",
            "-U",
            postgresUser,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${targetDatabase}' AND pid <> pg_backend_pid(); ALTER DATABASE \"${targetDatabase}\" RENAME TO \"${previousDatabase}\";`,
          ]),
        ),
      activateStaging: async () => {
        await run(
          "docker",
          compose([
            "psql",
            "-U",
            postgresUser,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `ALTER DATABASE \"${stagingDatabase}\" RENAME TO \"${targetDatabase}\";`,
          ]),
        );
        stagingDatabaseCreated = false;
        databaseActivated = true;
      },
      restorePrevious: () =>
        run(
          "docker",
          compose([
            "psql",
            "-U",
            postgresUser,
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `ALTER DATABASE \"${previousDatabase}\" RENAME TO \"${targetDatabase}\";`,
          ]),
        ),
    });

    console.log(`Restore completed into database ${targetDatabase}.`);
    if (targetExists) {
      console.log(`Previous database retained as ${previousDatabase}.`);
    }
    const previousPaths = activatedFiles.flatMap((entry) =>
      entry.previous ? [entry.previous] : [],
    );
    if (previousPaths.length > 0) {
      console.log(`Previous file roots retained: ${previousPaths.join(", ")}`);
    }
  } catch (error) {
    if (!databaseActivated && activatedFiles.length > 0) {
      try {
        await rollbackRestoredFileRoots(activatedFiles);
        activatedFiles = [];
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Restore failed and file rollback was incomplete",
        );
      }
    }
    throw error;
  } finally {
    if (stagingDatabaseCreated) {
      await run(
        "docker",
        compose(["dropdb", "-U", postgresUser, "--if-exists", stagingDatabase]),
      ).catch(() => undefined);
    }
    await rm(fileStaging, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
