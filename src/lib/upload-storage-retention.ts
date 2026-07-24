import {
  lstat,
  readdir,
  rm,
  rmdir,
} from "node:fs/promises";
import {
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { feedbackStorageKeyFromUrl } from "@/lib/feedback";
import { materialStorageKeyFromUrl } from "@/lib/materials";
import {
  parseUploadStorageKey,
  uploadDirectories,
} from "@/lib/upload-storage";
import { GENERATED_ARTIFACT_RETENTION_MS } from "@/lib/generated-artifact-retention";

const DATABASE_PAGE_SIZE = 500;
const DEFAULT_RETENTION_HOURS = 24;
export const UPLOAD_STORAGE_SWEEP_LOCK_NAME = "upload-storage-orphan-sweep";
const OWNER_SEGMENT = /^[A-Za-z0-9_-]+$/;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export interface UploadStorageSweepRoot {
  root: string;
  referencedStorageKeys: ReadonlySet<string>;
}

export interface UploadStorageSweepResult {
  rootsScanned: number;
  filesScanned: number;
  filesRemoved: number;
  bytesRemoved: number;
  directoriesRemoved: number;
}

export interface UploadStorageSweepRunResult extends UploadStorageSweepResult {
  skipped: boolean;
}

export interface UploadStorageSweepInput {
  roots: UploadStorageSweepRoot[];
  retentionMs: number;
  now?: number;
}

export interface UploadStorageSweepOptions {
  retentionMs?: number;
  now?: number;
}

export async function sweepOrphanUploadStorage(
  options: UploadStorageSweepOptions = {},
): Promise<UploadStorageSweepRunResult> {
  return prisma.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended(${UPLOAD_STORAGE_SWEEP_LOCK_NAME}, 0)
        ) AS locked
      `;
      if (!lock?.locked) return { ...emptySweepResult(), skipped: true };

      const referenced = await collectReferencedUploadStorageKeys(tx);
      const roots = mergeAndValidateRoots([
        ...uploadDirectories("materials").map((root) => ({
          root,
          referencedStorageKeys: referenced.materials,
        })),
        ...uploadDirectories("feedback").map((root) => ({
          root,
          referencedStorageKeys: referenced.feedback,
        })),
      ]);
      const result = await sweepUploadStorageFiles({
        roots,
        retentionMs:
          options.retentionMs ??
          positiveIntegerEnv(
            "UPLOAD_ORPHAN_RETENTION_HOURS",
            DEFAULT_RETENTION_HOURS,
          ) *
            60 *
            60 *
            1000,
        now: options.now,
      });
      return { ...result, skipped: false };
    },
    {
      maxWait: 15_000,
      timeout: positiveIntegerEnv(
        "UPLOAD_STORAGE_SWEEP_TIMEOUT_MS",
        10 * 60 * 1000,
      ),
    },
  );
}

export async function sweepUploadStorageFiles(
  input: UploadStorageSweepInput,
): Promise<UploadStorageSweepResult> {
  if (!Number.isSafeInteger(input.retentionMs) || input.retentionMs <= 0) {
    throw new Error("上传孤儿文件保留时间必须为正整数毫秒");
  }
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error("上传存储清理时间无效");

  const roots = mergeAndValidateRoots(input.roots);
  const cutoff = now - input.retentionMs;
  const result = emptySweepResult();

  for (const sweepRoot of roots) {
    const root = resolve(sweepRoot.root);
    const rootInfo = await lstatOrNull(root);
    if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      continue;
    }
    result.rootsScanned += 1;

    for (const entry of await readDirOrEmpty(root)) {
      if (entry.isFile()) {
        await sweepCandidate({
          path: join(root, entry.name),
          storageKey: entry.name,
          referencedStorageKeys: sweepRoot.referencedStorageKeys,
          cutoff,
          result,
        });
        continue;
      }
      if (!entry.isDirectory() || !OWNER_SEGMENT.test(entry.name)) continue;

      const ownerDirectory = join(root, entry.name);
      const ownerInfo = await lstatOrNull(ownerDirectory);
      if (
        !ownerInfo ||
        !ownerInfo.isDirectory() ||
        ownerInfo.isSymbolicLink()
      ) {
        continue;
      }
      for (const file of await readDirOrEmpty(ownerDirectory)) {
        if (!file.isFile()) continue;
        await sweepCandidate({
          path: join(ownerDirectory, file.name),
          storageKey: `${entry.name}/${file.name}`,
          referencedStorageKeys: sweepRoot.referencedStorageKeys,
          cutoff,
          result,
        });
      }
      if (
        ownerInfo.mtimeMs < cutoff &&
        (await removeEmptyDirectory(ownerDirectory))
      ) {
        result.directoriesRemoved += 1;
      }
    }
  }
  return result;
}

async function collectReferencedUploadStorageKeys(tx: Prisma.TransactionClient) {
  const materials = new Set<string>();
  let materialCursor: string | undefined;
  do {
    const rows = await tx.material.findMany({
      orderBy: { id: "asc" },
      take: DATABASE_PAGE_SIZE,
      ...(materialCursor
        ? { cursor: { id: materialCursor }, skip: 1 }
        : {}),
      select: {
        id: true,
        storageKey: true,
        url: true,
        thumbnailUrl: true,
      },
    });
    for (const row of rows) {
      addStorageKey(materials, row.storageKey);
      addStorageKey(materials, materialStorageKeyFromUrl(row.url));
      addStorageKey(
        materials,
        row.thumbnailUrl ? materialStorageKeyFromUrl(row.thumbnailUrl) : null,
      );
    }
    materialCursor = rows.at(-1)?.id;
    if (rows.length < DATABASE_PAGE_SIZE) break;
  } while (materialCursor);

  let imageTurnCursor: string | undefined;
  const imageResultCutoff = new Date(Date.now() - GENERATED_ARTIFACT_RETENTION_MS);
  do {
    const rows = await tx.imageTurn.findMany({
      where: {
        images: { not: null },
        artifactsDeletedAt: null,
        OR: [
          { status: "PENDING" },
          { completedAt: { gt: imageResultCutoff } },
          { completedAt: null, updatedAt: { gt: imageResultCutoff } },
        ],
      },
      orderBy: { id: "asc" },
      take: DATABASE_PAGE_SIZE,
      ...(imageTurnCursor
        ? { cursor: { id: imageTurnCursor }, skip: 1 }
        : {}),
      select: { id: true, images: true },
    });
    for (const row of rows) {
      collectImageTurnStorageKeys(row.images, materials);
    }
    imageTurnCursor = rows.at(-1)?.id;
    if (rows.length < DATABASE_PAGE_SIZE) break;
  } while (imageTurnCursor);

  const feedback = new Set<string>();
  let feedbackCursor: string | undefined;
  do {
    const rows = await tx.feedback.findMany({
      orderBy: { id: "asc" },
      take: DATABASE_PAGE_SIZE,
      ...(feedbackCursor
        ? { cursor: { id: feedbackCursor }, skip: 1 }
        : {}),
      select: { id: true, screenshotUrls: true },
    });
    for (const row of rows) {
      collectFeedbackStorageKeys(row.screenshotUrls, feedback);
    }
    feedbackCursor = rows.at(-1)?.id;
    if (rows.length < DATABASE_PAGE_SIZE) break;
  } while (feedbackCursor);

  return { materials, feedback };
}

function emptySweepResult(): UploadStorageSweepResult {
  return {
    rootsScanned: 0,
    filesScanned: 0,
    filesRemoved: 0,
    bytesRemoved: 0,
    directoriesRemoved: 0,
  };
}

function collectImageTurnStorageKeys(value: string | null, output: Set<string>) {
  if (!value) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const url = (item as { url?: unknown }).url;
      if (typeof url === "string") {
        addStorageKey(output, materialStorageKeyFromUrl(url));
      }
    }
  } catch {
    // Corrupt task history is ignored rather than widening the protected set.
  }
}

function collectFeedbackStorageKeys(value: string | null, output: Set<string>) {
  if (!value) return;
  const rawValue = value;
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (Array.isArray(parsed)) {
      for (const url of parsed) {
        if (typeof url === "string") {
          addStorageKey(output, feedbackStorageKeyFromUrl(url));
        }
      }
      return;
    }
  } catch {
    // Some early rows stored one URL directly instead of a JSON array.
  }
  addStorageKey(output, feedbackStorageKeyFromUrl(rawValue));
}

function addStorageKey(output: Set<string>, storageKey: string | null) {
  if (!storageKey) return;
  try {
    parseUploadStorageKey(storageKey);
    output.add(storageKey);
  } catch {
    // Invalid legacy values cannot identify a file inside an upload root.
  }
}

async function sweepCandidate(input: {
  path: string;
  storageKey: string;
  referencedStorageKeys: ReadonlySet<string>;
  cutoff: number;
  result: UploadStorageSweepResult;
}) {
  if (!IMAGE_EXTENSIONS.has(extname(input.storageKey).toLowerCase())) return;
  try {
    parseUploadStorageKey(input.storageKey);
  } catch {
    return;
  }
  const info = await lstatOrNull(input.path);
  if (!info || !info.isFile() || info.isSymbolicLink()) return;
  input.result.filesScanned += 1;
  if (
    input.referencedStorageKeys.has(input.storageKey) ||
    info.mtimeMs >= input.cutoff
  ) {
    return;
  }
  await rm(input.path, { force: true });
  input.result.filesRemoved += 1;
  input.result.bytesRemoved += info.size;
}

function mergeAndValidateRoots(roots: UploadStorageSweepRoot[]) {
  const merged = new Map<string, Set<string>>();
  for (const candidate of roots) {
    const root = resolve(candidate.root);
    const references = merged.get(root) ?? new Set<string>();
    for (const storageKey of candidate.referencedStorageKeys) {
      references.add(storageKey);
    }
    merged.set(root, references);
  }

  const paths = [...merged.keys()];
  for (let index = 0; index < paths.length; index += 1) {
    for (let other = index + 1; other < paths.length; other += 1) {
      if (
        isPathInside(paths[index], paths[other]) ||
        isPathInside(paths[other], paths[index])
      ) {
        throw new Error("上传存储目录不能互相嵌套，已跳过孤儿文件清理");
      }
    }
  }
  return paths.map((root) => ({
    root,
    referencedStorageKeys: merged.get(root)!,
  }));
}

function isPathInside(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    Boolean(path) &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

async function readDirOrEmpty(path: string) {
  return readdir(path, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
}

async function lstatOrNull(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function removeEmptyDirectory(path: string) {
  try {
    await rmdir(path);
    return true;
  } catch (error) {
    if (
      ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      return false;
    }
    throw error;
  }
}

function positiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
