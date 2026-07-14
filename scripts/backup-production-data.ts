import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
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

type Options = {
  dataDir: string;
  backupDir: string;
  composeFile: string;
  composeEnvFile?: string;
  composeProject: string;
  postgresService: string;
  postgresUser: string;
  postgresDatabase: string;
  keep: number;
  mirrorDir?: string;
  allowLiveWriters: boolean;
};

function readOptions(): Options {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item?.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=", 2);
    const nextValue = process.argv[index + 1];
    const value = inlineValue ?? nextValue;
    if (!value || (inlineValue === undefined && value.startsWith("--"))) {
      throw new Error(`Missing value for --${key}`);
    }
    if (inlineValue === undefined) index += 1;
    args.set(key, value);
  }

  const keep = Number(args.get("keep") ?? "14");
  if (!Number.isSafeInteger(keep) || keep < 1) {
    throw new Error("--keep must be a positive integer");
  }

  return {
    dataDir: resolve(process.cwd(), args.get("data-dir") ?? "data"),
    backupDir: resolve(
      process.cwd(),
      args.get("backup-dir") ?? "data/backups",
    ),
    composeFile: resolve(
      process.cwd(),
      args.get("compose-file") ?? "docker-compose.yml",
    ),
    composeEnvFile: resolveComposeEnvFile(args.get("env-file")),
    composeProject:
      args.get("compose-project")?.trim() ||
      process.env.COMPOSE_PROJECT_NAME?.trim() ||
      "ai-aggregator",
    postgresService: args.get("postgres-service") ?? "postgres",
    postgresUser: args.get("postgres-user") ?? "ai_aggregator",
    postgresDatabase: args.get("postgres-database") ?? "ai_aggregator",
    keep,
    mirrorDir: args.get("mirror-dir")
      ? resolve(process.cwd(), args.get("mirror-dir")!)
      : process.env.BACKUP_MIRROR_DIR
        ? resolve(process.cwd(), process.env.BACKUP_MIRROR_DIR)
        : undefined,
    allowLiveWriters: readBooleanArg(args, "allow-live-writers", false),
  };
}

function readBooleanArg(
  args: Map<string, string>,
  name: string,
  fallback: boolean,
) {
  const value = args.get(name);
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${name} must be true or false`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function runCommand(
  command: string,
  args: string[],
  options: { stdinPath?: string; ignoreStdout?: boolean } = {},
) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: [
        options.stdinPath ? "pipe" : "ignore",
        options.ignoreStdout ? "ignore" : "inherit",
        "inherit",
      ],
    });
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolvePromise();
    };
    if (options.stdinPath) {
      if (!child.stdin) {
        child.kill();
        finish(new Error(`${command} stdin is unavailable`));
        return;
      }
      const input = createReadStream(options.stdinPath);
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
      if (code === 0) {
        finish();
        return;
      }
      finish(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
        ),
      );
    });
  });
}

async function dumpPostgres(options: Options, destination: string) {
  const partialPath = `${destination}.partial`;
  await rm(partialPath, { force: true });

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const output = createWriteStream(partialPath, { mode: 0o600 });
      const child = spawn(
        "docker",
        composeCommandArgs({
          project: options.composeProject,
          composeFile: options.composeFile,
          envFile: options.composeEnvFile,
          service: options.postgresService,
          command: [
            "pg_dump",
            "--username",
            options.postgresUser,
            "--dbname",
            options.postgresDatabase,
            "--format=custom",
            "--no-owner",
            "--no-privileges",
          ],
        }),
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      let childClosed = false;
      let outputFinished = false;
      let settled = false;

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        child.kill();
        output.destroy();
        reject(error);
      };
      const finish = () => {
        if (settled || !childClosed || !outputFinished) return;
        settled = true;
        resolvePromise();
      };

      child.stdout.pipe(output);
      child.once("error", fail);
      child.once("close", (code, signal) => {
        if (code !== 0) {
          fail(
            new Error(
              `pg_dump exited with ${code ?? `signal ${signal ?? "unknown"}`}`,
            ),
          );
          return;
        }
        childClosed = true;
        finish();
      });
      output.once("error", fail);
      output.once("finish", () => {
        outputFinished = true;
        finish();
      });
    });

    const file = await open(partialPath, "r");
    try {
      const magic = Buffer.alloc(5);
      const { bytesRead } = await file.read(magic, 0, magic.length, 0);
      if (bytesRead !== magic.length || magic.toString("ascii") !== "PGDMP") {
        throw new Error("pg_dump output is not a valid PostgreSQL custom archive");
      }
    } finally {
      await file.close();
    }
    await rename(partialPath, destination);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}

async function archiveProjectFiles(options: Options, destination: string) {
  const relativePaths = [
    "uploads",
    "image-inputs",
    "ppt-uploads",
    "ppt-projects",
  ].filter((path) => existsSync(join(options.dataDir, path)));
  if (relativePaths.length === 0) return [];

  await runCommand("tar", [
    "-czf",
    destination,
    "-C",
    options.dataDir,
    ...relativePaths,
  ]);
  return relativePaths;
}

async function runCapture(command: string, args: string[]) {
  const result = await runBoundedProcess(command, args, {
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
    outputLimitError: () =>
      new Error(`${command} output exceeds the 64 MiB backup limit`),
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} exited with ${result.exitCode ?? `signal ${result.signal ?? "unknown"}`}: ${result.stderr.slice(-4_000)}`,
    );
  }
  return result.stdout;
}

async function assertBackupWriterState(options: Options) {
  const output = await runCapture(
    "docker",
    composeCommandArgs({
      project: options.composeProject,
      composeFile: options.composeFile,
      envFile: options.composeEnvFile,
      command: ["ps", "--status", "running", "--services"],
    }),
  );
  const running = new Set(
    output
      .split("\n")
      .map((service) => service.trim())
      .filter(Boolean),
  );
  const writers = ["app", "image-worker", "ppt-worker"].filter((service) =>
    running.has(service),
  );
  if (writers.length === 0) return;
  if (!options.allowLiveWriters) {
    throw new Error(
      `Stop application writers before backup: ${writers.join(", ")}. ` +
        "Use --allow-live-writers true only when accepting a non-transactional file snapshot.",
    );
  }
  console.warn(
    `Creating a live backup while ${writers.join(", ")} are running; database and files may not represent one point in time.`,
  );
}

async function validateCreatedArchives(
  options: Options,
  databasePath: string,
  filesPath: string,
  archivedPaths: string[],
) {
  await runCommand(
    "docker",
    composeCommandArgs({
      project: options.composeProject,
      composeFile: options.composeFile,
      envFile: options.composeEnvFile,
      service: options.postgresService,
      command: ["pg_restore", "--list"],
    }),
    { stdinPath: databasePath, ignoreStdout: true },
  );
  if (archivedPaths.length === 0) return;
  const listing = await runCapture("tar", [
    "--quoting-style=literal",
    "-tzf",
    filesPath,
  ]);
  assertSafeArchiveEntries(listing, archivedPaths);
  assertSafeArchiveEntryTypes(
    await runCapture("tar", [
      "--quoting-style=literal",
      "-tvzf",
      filesPath,
    ]),
  );
}

async function pruneOldSnapshots(backupDir: string, keep: number) {
  const entries = await readdir(backupDir, { withFileTypes: true });
  const snapshots = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(entry.name) &&
          existsSync(join(backupDir, entry.name, "manifest.json")),
      )
      .map(async (entry) => {
        const path = join(backupDir, entry.name);
        return { path, name: entry.name, mtimeMs: (await stat(path)).mtimeMs };
      }),
  );
  snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const snapshot of snapshots.slice(keep)) {
    await rm(snapshot.path, { recursive: true, force: true });
    console.log(`Removed old backup snapshot ${snapshot.name}`);
  }
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

async function mirrorSnapshot(
  snapshotDir: string,
  mirrorRoot: string,
  snapshotName: string,
) {
  const resolvedSource = resolve(snapshotDir);
  const resolvedMirror = resolve(mirrorRoot);
  if (
    resolvedMirror === resolvedSource ||
    resolvedMirror.startsWith(`${resolvedSource}/`)
  ) {
    throw new Error("Backup mirror directory cannot be inside the snapshot");
  }
  await mkdir(resolvedMirror, { recursive: true, mode: 0o700 });
  const destination = join(resolvedMirror, snapshotName);
  const partial = `${destination}.partial`;
  await rm(partial, { recursive: true, force: true });
  if (existsSync(destination)) {
    throw new Error(`Backup mirror snapshot already exists: ${destination}`);
  }
  try {
    await cp(snapshotDir, partial, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }
  return destination;
}

async function main() {
  const options = readOptions();
  await assertBackupWriterState(options);
  const snapshotName = timestamp();
  const snapshotDir = join(options.backupDir, snapshotName);
  const databasePath = join(snapshotDir, "database.dump");
  const filesPath = join(snapshotDir, "files.tar.gz");

  await mkdir(options.backupDir, { recursive: true, mode: 0o700 });
  await mkdir(snapshotDir, { mode: 0o700 });
  try {
    console.log("Creating PostgreSQL backup...");
    await dumpPostgres(options, databasePath);
    const archivedPaths = await archiveProjectFiles(options, filesPath);
    if (archivedPaths.length === 0) {
      console.warn("No uploaded or generated project files were found to archive.");
    }
    await validateCreatedArchives(
      options,
      databasePath,
      filesPath,
      archivedPaths,
    );

    const databaseStats = await stat(databasePath);
    const filesStats = archivedPaths.length > 0 ? await stat(filesPath) : null;
    const [databaseSha256, filesSha256] = await Promise.all([
      sha256File(databasePath),
      filesStats ? sha256File(filesPath) : Promise.resolve(null),
    ]);
    await writeFile(
      join(snapshotDir, "manifest.json"),
      `${JSON.stringify(
        {
          version: 2,
          createdAt: new Date().toISOString(),
          postgres: {
            database: options.postgresDatabase,
            service: options.postgresService,
            format: "custom",
            bytes: databaseStats.size,
            sha256: databaseSha256,
          },
          files: {
            included: archivedPaths,
            bytes: filesStats?.size ?? 0,
            sha256: filesSha256,
          },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await verifyBackupSnapshot(snapshotDir);
  } catch (error) {
    await rm(snapshotDir, { recursive: true, force: true });
    throw error;
  }

  if (options.mirrorDir) {
    const mirrored = await mirrorSnapshot(
      snapshotDir,
      options.mirrorDir,
      snapshotName,
    );
    console.log(`Mirrored production backup snapshot ${mirrored}`);
  }
  await pruneOldSnapshots(options.backupDir, options.keep);
  if (options.mirrorDir) {
    await pruneOldSnapshots(options.mirrorDir, options.keep);
  }
  console.log(`Created production backup snapshot ${snapshotDir}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
