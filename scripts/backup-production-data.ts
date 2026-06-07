import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { readdir, rm } from "fs/promises";
import { basename, join, resolve } from "path";
import { createGzip } from "zlib";

type Options = {
  dataDir: string;
  backupDir: string;
  keep: number;
};

function readOptions(): Options {
  const args = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item?.startsWith("--")) continue;
    const [key, inlineValue] = item.slice(2).split("=", 2);
    const value = inlineValue ?? process.argv[index + 1];
    if (inlineValue === undefined) index += 1;
    args.set(key, value);
  }

  return {
    dataDir: resolve(process.cwd(), args.get("data-dir") ?? "data"),
    backupDir: resolve(process.cwd(), args.get("backup-dir") ?? "backups"),
    keep: Number(args.get("keep") ?? "14"),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function gzipFile(source: string, destination: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const input = createReadStream(source);
    const output = createWriteStream(destination);
    input
      .on("error", reject)
      .pipe(createGzip())
      .on("error", reject)
      .pipe(output)
      .on("error", reject)
      .on("finish", resolvePromise);
  });
}

async function pruneOldBackups(backupDir: string, keep: number) {
  if (keep <= 0) return;

  const entries = await readdir(backupDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".gz"))
    .map((entry) => {
      const path = join(backupDir, entry.name);
      return { path, name: entry.name, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const file of files.slice(keep)) {
    await rm(file.path);
    console.log(`Removed old backup ${file.name}`);
  }
}

async function main() {
  const options = readOptions();
  const dbPath = join(options.dataDir, "db", "dev.db");
  const uploadsPath = join(options.dataDir, "uploads");

  if (!existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  mkdirSync(options.backupDir, { recursive: true });
  const stamp = timestamp();
  const dbBackup = join(options.backupDir, `dev-${stamp}.db.gz`);
  await gzipFile(dbPath, dbBackup);
  console.log(`Created database backup ${basename(dbBackup)}`);

  if (existsSync(uploadsPath)) {
    const uploadsBackup = join(options.backupDir, `uploads-${stamp}.tar.gz`);
    const tar = await import("child_process").then(({ spawn }) => {
      return new Promise<number>((resolvePromise, reject) => {
        const child = spawn("tar", ["-czf", uploadsBackup, "-C", options.dataDir, "uploads"], {
          stdio: "inherit",
        });
        child.on("error", reject);
        child.on("close", resolvePromise);
      });
    });
    if (tar !== 0) {
      console.error("Failed to create uploads archive with tar.");
      process.exit(tar);
    }
    console.log(`Created uploads backup ${basename(uploadsBackup)}`);
  } else {
    console.warn(`Uploads directory not found, skipped: ${uploadsPath}`);
  }

  await pruneOldBackups(options.backupDir, options.keep);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
