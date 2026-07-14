import { lstat, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export type UploadStorageKind = "materials" | "feedback";

const STORAGE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function getUploadStorageRoot() {
  return resolve(
    /* turbopackIgnore: true */ process.env.UPLOAD_STORAGE_ROOT ||
      join(process.cwd(), "data", "uploads"),
  );
}

export function getUploadDirectory(kind: UploadStorageKind) {
  const override =
    kind === "materials"
      ? process.env.MATERIAL_UPLOAD_ROOT
      : process.env.FEEDBACK_UPLOAD_ROOT;
  const defaultDirectory =
    kind === "materials"
      ? join(getUploadStorageRoot(), "materials")
      : join(getUploadStorageRoot(), "feedback");
  return resolve(
    /* turbopackIgnore: true */ override || defaultDirectory,
  );
}

export function getLegacyUploadDirectory(kind: UploadStorageKind) {
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "public",
    "uploads",
    kind,
  );
}

export function uploadDirectories(kind: UploadStorageKind) {
  const primary = getUploadDirectory(kind);
  const explicit =
    kind === "materials"
      ? process.env.MATERIAL_UPLOAD_ROOT
      : process.env.FEEDBACK_UPLOAD_ROOT;
  if (explicit) return [primary];
  const legacy = getLegacyUploadDirectory(kind);
  return primary === legacy ? [primary] : [primary, legacy];
}

export function parseUploadStorageKey(
  storageKey: string,
  maxSegments = 2,
) {
  const segments = storageKey.split("/");
  if (
    segments.length < 1 ||
    segments.length > maxSegments ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !STORAGE_SEGMENT.test(segment),
    )
  ) {
    throw new Error("无效的文件标识");
  }
  return segments;
}

export function resolveUploadStoragePath(
  root: string,
  storageKey: string,
  maxSegments = 2,
) {
  const normalizedRoot = resolve(/* turbopackIgnore: true */ root);
  const absolutePath = resolve(
    /* turbopackIgnore: true */ normalizedRoot,
    ...parseUploadStorageKey(storageKey, maxSegments),
  );
  const prefix = normalizedRoot.endsWith(sep)
    ? normalizedRoot
    : `${normalizedRoot}${sep}`;
  if (!absolutePath.startsWith(prefix)) throw new Error("文件路径非法");
  return absolutePath;
}

export async function findStoredUploadFile(
  kind: UploadStorageKind,
  storageKey: string,
) {
  for (const root of uploadDirectories(kind)) {
    const path = resolveUploadStoragePath(root, storageKey);
    const info = await lstat(/* turbopackIgnore: true */ path).catch(() => null);
    if (info?.isFile() && !info.isSymbolicLink()) return { path, info };
  }
  return null;
}

export async function deleteStoredUploadFile(
  kind: UploadStorageKind,
  storageKey: string,
) {
  let segments: string[];
  try {
    segments = parseUploadStorageKey(storageKey);
  } catch {
    return;
  }
  await Promise.all(
    uploadDirectories(kind).map(async (root) => {
      const path = resolveUploadStoragePath(root, segments.join("/"));
      const info = await lstat(/* turbopackIgnore: true */ path).catch(
        () => null,
      );
      if (!info?.isFile() || info.isSymbolicLink()) return;
      await rm(/* turbopackIgnore: true */ path, { force: true });
    }),
  );
}
