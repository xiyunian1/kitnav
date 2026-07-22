import { lstat, readdir, realpath } from "fs/promises";
import { join, resolve, sep, basename, isAbsolute } from "path";

export interface ProjectSvgPreview {
  filename: string;
  url: string;
  revision: string;
}

export const PPT_PROJECTS_ROOT = resolve(
  /* turbopackIgnore: true */ process.env.PPT_PROJECTS_ROOT ||
    join(process.cwd(), "data", "ppt-projects"),
);

export function getPptProjectDir(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid PPT project id");
  }
  return join(/* turbopackIgnore: true */ PPT_PROJECTS_ROOT, projectId);
}

export function assertInsidePptProject(projectId: string, path: string) {
  const projectDir = getPptProjectDir(projectId);
  const resolved = isAbsolute(path)
    ? resolve(/* turbopackIgnore: true */ path)
    : resolve(/* turbopackIgnore: true */ projectDir, path);
  const normalizedRoot = projectDir.endsWith(sep) ? projectDir : `${projectDir}${sep}`;
  if (resolved !== projectDir && !resolved.startsWith(normalizedRoot)) {
    throw new Error("Resolved path is outside the PPT project directory");
  }
  return resolved;
}

export async function resolvePptProjectFile(projectId: string, path: string) {
  const projectDir = getPptProjectDir(projectId);
  const candidate = assertInsidePptProject(projectId, path);
  const info = await lstat(/* turbopackIgnore: true */ candidate);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("PPT project file is not a regular file");
  }

  const [rootRealPath, projectRealPath, fileRealPath] = await Promise.all([
    realpath(/* turbopackIgnore: true */ PPT_PROJECTS_ROOT),
    realpath(/* turbopackIgnore: true */ projectDir),
    realpath(/* turbopackIgnore: true */ candidate),
  ]);
  assertResolvedPathInside(rootRealPath, projectRealPath);
  assertResolvedPathInside(projectRealPath, fileRealPath);
  return { path: fileRealPath, size: info.size };
}

function assertResolvedPathInside(root: string, candidate: string) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(normalizedRoot)) {
    throw new Error("Resolved path is outside the expected directory");
  }
}

export function publicProjectUrl(projectId: string, absolutePath: string) {
  const projectDir = getPptProjectDir(projectId);
  const resolved = assertInsidePptProject(projectId, absolutePath);
  const relative = resolved.slice(projectDir.length).replaceAll("\\", "/").replace(/^\/+/, "");
  return `/api/ppt/projects/${projectId}/files/${relative
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export async function getProjectSvgPreviews(projectId: string) {
  const svgDir = join(
    /* turbopackIgnore: true */ getPptProjectDir(projectId),
    "svg_output",
  );
  try {
    const info = await lstat(svgDir);
    if (!info.isDirectory() || info.isSymbolicLink()) return [];

    const files = (await readdir(svgDir))
      .filter((file) => file.toLowerCase().endsWith(".svg"))
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
      .slice(0, 30);

    const previews = await Promise.all(
      files.map(async (file): Promise<ProjectSvgPreview | null> => {
        try {
          const fileInfo = await lstat(join(svgDir, file));
          if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) return null;
          const revision = `${Math.trunc(fileInfo.mtimeMs)}-${fileInfo.size}`;
          return {
            filename: file,
            url: `/api/ppt/projects/${projectId}/files/svg_output/${encodeURIComponent(file)}?v=${encodeURIComponent(revision)}`,
            revision,
          };
        } catch {
          // A page may be atomically replaced while a status poll is running.
          return null;
        }
      }),
    );
    return previews.filter(
      (preview): preview is ProjectSvgPreview => preview !== null,
    );
  } catch {
    return [];
  }
}

export function safeDownloadName(title: string) {
  return `${basename(title).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 80) || "presentation"}.pptx`;
}
