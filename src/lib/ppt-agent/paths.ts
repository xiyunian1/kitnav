import { readdir, stat } from "fs/promises";
import { join, resolve, sep, basename, isAbsolute } from "path";

export const PPT_PROJECTS_ROOT = resolve(process.cwd(), "data", "ppt-projects");

export function getPptProjectDir(projectId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error("Invalid PPT project id");
  }
  return join(PPT_PROJECTS_ROOT, projectId);
}

export function assertInsidePptProject(projectId: string, path: string) {
  const projectDir = getPptProjectDir(projectId);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
  const normalizedRoot = projectDir.endsWith(sep) ? projectDir : `${projectDir}${sep}`;
  if (resolved !== projectDir && !resolved.startsWith(normalizedRoot)) {
    throw new Error("Resolved path is outside the PPT project directory");
  }
  return resolved;
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
  const svgDir = join(getPptProjectDir(projectId), "svg_output");
  try {
    const info = await stat(svgDir);
    if (!info.isDirectory()) return [];
  } catch {
    return [];
  }

  const files = (await readdir(svgDir))
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));

  return files.map((file) => ({
    filename: file,
    url: `/api/ppt/projects/${projectId}/files/svg_output/${encodeURIComponent(file)}`,
  }));
}

export function safeDownloadName(title: string) {
  return `${basename(title).replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 80) || "presentation"}.pptx`;
}
