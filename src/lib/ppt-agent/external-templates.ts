import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, extname, join } from "path";
import { importPptxTemplate, readImportedTemplate } from "./project-tools";

const YPPPT_HOSTS = new Set(["ypppt.com", "www.ypppt.com"]);
const YPPPT_DOWNLOAD_HOST = "down.ypppt.com";
const ARCHIVE_EXTENSIONS = new Set([".zip", ".rar", ".7z"]);
const OOXML_TEMPLATE_EXTENSIONS = new Set([".pptx", ".potx", ".pptm", ".potm", ".ppsx", ".ppsm"]);
const LEGACY_TEMPLATE_EXTENSIONS = new Set([".ppt", ".pot", ".pps"]);

interface ResolvedTemplateDownload {
  pageUrl: string;
  downloadUrl: string;
  title: string;
}

interface DownloadedTemplateFile {
  path: string;
  filename: string;
}

export function isExternalPptTemplateUrl(rawUrl: string) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.hostname.toLowerCase() === YPPPT_DOWNLOAD_HOST && isSupportedDownloadPath(url.pathname)) return true;
  if (!YPPPT_HOSTS.has(url.hostname.toLowerCase())) return false;
  return extractYppptAid(url) !== "";
}

export async function importExternalPptTemplateUrls(
  projectDir: string,
  urls: string[] | undefined,
  slideCount: number,
  signal?: AbortSignal
) {
  const url = uniqueStrings(urls || []).find(isExternalPptTemplateUrl);
  if (!url) return "";

  const resolved = await resolveTemplateDownload(url, signal);
  const downloaded = await downloadTemplateFile(projectDir, resolved, signal);
  const templateFile = await prepareTemplateFile(projectDir, downloaded, signal);
  const importName = normalizeImportFilename(templateFile);
  const result = await importPptxTemplate(projectDir, importName, readFileSync(templateFile));
  const sourceInfo = {
    source: "ypppt",
    pageUrl: resolved.pageUrl,
    downloadUrl: resolved.downloadUrl,
    title: resolved.title,
    filename: downloaded.filename,
    importedFilename: result.filename,
    importedAt: new Date().toISOString(),
  };
  const importedDir = join(projectDir, "templates", "imported");
  writeFileSync(join(importedDir, "external-source.json"), `${JSON.stringify(sourceInfo, null, 2)}\n`, "utf-8");

  const imported = readImportedTemplate(projectDir);
  const templateBaseGuidance = buildImportedTemplateBaseGuidance(projectDir, slideCount);
  return [
    `已导入外部 PPT 模板：${resolved.title || result.filename}`,
    `来源页面：${resolved.pageUrl}`,
    `模板下载：${resolved.downloadUrl}`,
    "项目模板目录：templates/imported",
    imported.summary ? `模板摘要：\n${imported.summary}` : "",
    templateBaseGuidance,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildImportedTemplateBaseGuidance(projectDir: string, slideCount: number) {
  const flatDir = join(projectDir, "templates", "imported", "svg-flat");
  if (!existsSync(flatDir)) return "";

  const files = readdirSync(flatDir)
    .filter((file) => /^slide_\d+\.svg$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  if (files.length === 0) return "";

  const summaryPath = join(projectDir, "templates", "imported", "summary.md");
  const summary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf-8") : "";
  const selected = buildTemplatePageMapping(files, summary, slideCount);
  const refsDir = join(projectDir, "template_refs");
  mkdirSync(refsDir, { recursive: true });

  const mapping = selected.map((sourceSlide, index) => {
    const targetNo = index + 1;
    const sourceFile = `slide_${String(sourceSlide).padStart(2, "0")}.svg`;
    const outputReadyFile = `target_${String(targetNo).padStart(2, "0")}_from_slide_${String(sourceSlide).padStart(2, "0")}.svg`;
    const sourcePath = join(flatDir, sourceFile);
    const outputReadyPath = join(refsDir, outputReadyFile);
    writeFileSync(outputReadyPath, rewriteTemplateAssetPaths(readFileSync(sourcePath, "utf-8")), "utf-8");
    return {
      targetSlide: targetNo,
      sourceSlide,
      sourceSvg: `templates/imported/svg-flat/${sourceFile}`,
      outputReadySvg: `template_refs/${outputReadyFile}`,
    };
  });

  const mapMd = [
    "# Imported PPT Template Base Map",
    "",
    "外部模板已启用。生成必须采用“模板底稿优先”工作流，而不是只参考颜色。",
    "",
    "硬性要求：",
    "- 每一页输出前，先读取本文件，再读取对应 `outputReadySvg`。",
    "- 以 `outputReadySvg` 的 SVG 结构为底稿改写，不要从空白页面重新设计。",
    "- 尽量保留模板的背景、主装饰、卡片、阴影、图形层次、标题区、页脚和整体空间关系。",
    "- 只替换与本任务不匹配的文字、少量内容图形和明显无关素材。",
    "- 删除或替换模板中的下载站、水印、广告、年份占位、英文口号等无关可见文字。",
    "- 输出文件仍写入 `svg_output/NN_slide.svg`，并保持所有可见文字为简体中文。",
    "",
    "页面映射：",
    ...mapping.map(
      (item) =>
        `- P${String(item.targetSlide).padStart(2, "0")}: base=${item.outputReadySvg} original=${item.sourceSvg}`
    ),
    "",
  ].join("\n");
  writeFileSync(join(refsDir, "template-map.md"), mapMd, "utf-8");
  writeFileSync(join(refsDir, "template-map.json"), `${JSON.stringify(mapping, null, 2)}\n`, "utf-8");

  return [
    "## 外部模板套版规则",
    "",
    "本项目不是自由设计。必须使用 `template_refs/template-map.md` 中的页面映射作为每页 SVG 底稿。",
    "生成每一页时，读取对应 `template_refs/target_XX_from_slide_YY.svg`，在其结构上替换内容。",
    "保留模板版式骨架、背景、主装饰、卡片、阴影、页眉页脚、图形层次与空间比例；不要只提取颜色后重画。",
    "如果模板页含图片引用，保留可服务主题的图片；不合适时用同等位置和尺寸的形状或新内容替换。",
    "必须删除模板自带广告、水印、下载站署名、年份占位和英文励志句等无关内容。",
    "",
    "页面映射：",
    ...mapping.map(
      (item) =>
        `- 第 ${item.targetSlide} 页必须以 ${item.outputReadySvg} 为底稿（原模板 ${item.sourceSvg}）。`
    ),
  ].join("\n");
}

export function readImportedTemplateReferenceForSlide(projectDir: string, pageIndex: number) {
  const slideNo = pageIndex + 1;
  const refsDir = join(projectDir, "template_refs");
  if (!existsSync(refsDir)) return null;
  const prefix = `target_${String(slideNo).padStart(2, "0")}_`;
  const filename = readdirSync(refsDir).find((file) => file.startsWith(prefix) && file.endsWith(".svg"));
  if (!filename) return null;
  const relativePath = `template_refs/${filename}`;
  const absolutePath = join(refsDir, filename);
  return {
    path: relativePath,
    svg: readFileSync(absolutePath, "utf-8"),
  };
}

async function resolveTemplateDownload(rawUrl: string, signal?: AbortSignal): Promise<ResolvedTemplateDownload> {
  const url = parseUrl(rawUrl);
  if (!url) throw new Error("PPT 模板链接格式不正确。");
  const host = url.hostname.toLowerCase();

  if (host === YPPPT_DOWNLOAD_HOST && isSupportedDownloadPath(url.pathname)) {
    return {
      pageUrl: url.toString(),
      downloadUrl: url.toString(),
      title: decodeFilename(basename(url.pathname)) || "YPPPT 模板",
    };
  }

  if (!YPPPT_HOSTS.has(host)) {
    throw new Error("当前只支持从 ypppt.com 导入 PPT 模板链接。");
  }

  const aid = extractYppptAid(url);
  if (!aid) {
    throw new Error("请输入 YPPPT 模板详情页或下载页链接。");
  }

  const pageUrl = url.pathname.startsWith("/article/") ? url.toString() : `https://www.ypppt.com/article/${aid}.html`;
  const downloadPageUrl = `https://www.ypppt.com/p/d.php?aid=${encodeURIComponent(aid)}`;
  const [sourceHtml, downloadHtml] = await Promise.all([
    fetchHtml(url.toString(), signal).catch(() => ""),
    fetchHtml(downloadPageUrl, signal),
  ]);
  const downloadUrl = extractDownloadUrl(downloadHtml);
  if (!downloadUrl) {
    throw new Error("没有在 YPPPT 下载页找到可用的 PPT 模板下载地址。");
  }

  return {
    pageUrl,
    downloadUrl,
    title: extractHtmlTitle(sourceHtml) || extractHtmlTitle(downloadHtml) || `YPPPT 模板 ${aid}`,
  };
}

async function downloadTemplateFile(
  projectDir: string,
  resolved: ResolvedTemplateDownload,
  signal?: AbortSignal
): Promise<DownloadedTemplateFile> {
  const url = parseUrl(resolved.downloadUrl);
  if (!url || url.hostname.toLowerCase() !== YPPPT_DOWNLOAD_HOST || !isSupportedDownloadPath(url.pathname)) {
    throw new Error("YPPPT 模板下载地址不在允许范围内。");
  }

  const maxBytes = Number(process.env.PPT_EXTERNAL_TEMPLATE_MAX_BYTES || 100 * 1024 * 1024);
  const response = await fetchWithTimeout(url.toString(), signal, 120_000);
  if (!response.ok) {
    throw new Error(`下载 PPT 模板失败：HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`PPT 模板不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB。`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length <= 0) throw new Error("下载到的 PPT 模板为空。");
  if (buffer.length > maxBytes) {
    throw new Error(`PPT 模板不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB。`);
  }

  const dir = join(projectDir, "template_downloads");
  mkdirSync(dir, { recursive: true });
  const filename = safeFilename(decodeFilename(basename(url.pathname)), `template${extname(url.pathname) || ".bin"}`);
  const path = join(dir, `${Date.now()}-${filename}`);
  writeFileSync(path, buffer);
  return { path, filename };
}

async function prepareTemplateFile(projectDir: string, downloaded: DownloadedTemplateFile, signal?: AbortSignal) {
  const ext = extname(downloaded.path).toLowerCase();
  if (OOXML_TEMPLATE_EXTENSIONS.has(ext)) return downloaded.path;
  if (LEGACY_TEMPLATE_EXTENSIONS.has(ext)) {
    throw new Error("暂不支持旧版 .ppt 模板，请使用 .pptx/.potx 模板。");
  }
  if (!ARCHIVE_EXTENSIONS.has(ext)) {
    throw new Error("YPPPT 下载包不是支持的 PPT 模板格式。");
  }

  const extractDir = join(projectDir, "template_downloads", `extracted-${Date.now()}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  await extractArchive(downloaded.path, extractDir, signal);

  const templateFile = findTemplateFile(extractDir);
  if (!templateFile) {
    throw new Error("压缩包内没有找到 .pptx/.potx 模板文件。");
  }
  return templateFile;
}

async function extractArchive(archivePath: string, outputDir: string, signal?: AbortSignal) {
  const configured = process.env.PPT_ARCHIVE_EXTRACTOR?.trim();
  const isRar = extname(archivePath).toLowerCase() === ".rar";
  const extractors = configured ? [configured] : isRar ? ["unrar", "7z", "7zz", "7za"] : ["7z", "7zz", "7za", "unrar"];
  let lastError: unknown;
  for (const extractor of extractors) {
    try {
      await runExtractor(extractor, archivePath, outputDir, signal);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ENOENT|not found|spawn/i.test(message)) {
        throw error;
      }
    }
  }
  throw new Error(
    `服务器缺少可用的 RAR/ZIP 解压器，无法解压 YPPPT 模板压缩包。${
      lastError instanceof Error ? lastError.message : ""
    }`
  );
}

async function runExtractor(extractor: string, archivePath: string, outputDir: string, signal?: AbortSignal) {
  const name = basename(extractor).toLowerCase();
  if (name === "unrar" || name === "unrar-free") {
    await runCommand(extractor, ["x", "-o+", archivePath, ensureTrailingSlash(outputDir)], 240_000, signal);
    return;
  }
  await runCommand(extractor, ["x", "-y", `-o${outputDir}`, archivePath], 240_000, signal);
}

function findTemplateFile(dir: string): string {
  const candidates: string[] = [];
  const legacyCandidates: string[] = [];
  walk(dir, (file) => {
    const ext = extname(file).toLowerCase();
    if (OOXML_TEMPLATE_EXTENSIONS.has(ext)) candidates.push(file);
    if (LEGACY_TEMPLATE_EXTENSIONS.has(ext)) legacyCandidates.push(file);
  });

  if (candidates.length > 0) {
    return candidates.sort((a, b) => statSync(b).size - statSync(a).size)[0];
  }
  if (legacyCandidates.length > 0) {
    throw new Error("压缩包内只有旧版 .ppt 模板，暂不支持导入。");
  }
  return "";
}

function buildTemplatePageMapping(files: string[], summary: string, slideCount: number) {
  const available = files
    .map((file) => Number(file.match(/slide_(\d+)\.svg/i)?.[1]))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const targetCount = Math.max(1, Math.min(30, Math.round(slideCount || 10)));
  const cover = firstAvailable(parseCandidateSlides(summary, "cover_candidate"), available) || available[0];
  const toc = firstAvailable(parseCandidateSlides(summary, "toc_candidate"), available) || available[1] || cover;
  const ending =
    firstAvailable(parseCandidateSlides(summary, "ending_candidate"), available) || available.at(-1) || cover;
  const contentCandidates = parseCandidateSlides(summary, "content_candidate").filter((item) => available.includes(item));
  const contentPool =
    contentCandidates.length > 0
      ? contentCandidates
      : available.filter((item) => item !== cover && item !== toc && item !== ending);
  const fallbackPool = contentPool.length > 0 ? contentPool : available;

  return Array.from({ length: targetCount }, (_, index) => {
    const slideNo = index + 1;
    if (slideNo === 1) return cover;
    if (targetCount >= 3 && slideNo === targetCount) return ending;
    if (targetCount >= 4 && slideNo === 2) return toc;
    return fallbackPool[(index - (targetCount >= 4 ? 2 : 1) + fallbackPool.length) % fallbackPool.length] || cover;
  });
}

function parseCandidateSlides(summary: string, key: string) {
  const match = summary.match(new RegExp(`${key}:\\s*slides\\s+([^\\n]+)`, "i"));
  if (!match?.[1]) return [];
  return match[1]
    .match(/\d+/g)
    ?.map(Number)
    .filter((value) => Number.isFinite(value) && value > 0) || [];
}

function firstAvailable(candidates: number[], available: number[]) {
  return candidates.find((item) => available.includes(item)) || 0;
}

function rewriteTemplateAssetPaths(svg: string) {
  return svg
    .replaceAll('href="../assets/', 'href="../templates/imported/assets/')
    .replaceAll("href='../assets/", "href='../templates/imported/assets/")
    .replaceAll('xlink:href="../assets/', 'xlink:href="../templates/imported/assets/')
    .replaceAll("xlink:href='../assets/", "xlink:href='../templates/imported/assets/");
}

function ensureTrailingSlash(path: string) {
  return path.endsWith("/") || path.endsWith("\\") ? path : `${path}/`;
}

function walk(dir: string, onFile: (file: string) => void) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, onFile);
    } else if (entry.isFile()) {
      onFile(path);
    }
  }
}

function normalizeImportFilename(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  const name = safeFilename(basename(filePath), "external-template.pptx");
  if (ext === ".pptx") return name;
  return `${name.replace(/\.[^.]+$/, "")}.pptx`;
}

function extractDownloadUrl(html: string) {
  const matches = html.match(/https?:\/\/down\.ypppt\.com\/[^"' <>\r\n]+\.(?:rar|zip|7z|pptx|potx|ppt)(?:\?[^"' <>\r\n]*)?/gi);
  return matches?.find((item) => {
    const url = parseUrl(item);
    return Boolean(url && url.hostname.toLowerCase() === YPPPT_DOWNLOAD_HOST && isSupportedDownloadPath(url.pathname));
  }) || "";
}

function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return sanitizeText(match?.[1] || "").replace(/[-_【].*$/, "").slice(0, 120);
}

async function fetchHtml(url: string, signal?: AbortSignal) {
  const response = await fetchWithTimeout(url, signal, 45_000);
  if (!response.ok) throw new Error(`获取模板页面失败：HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const charset = response.headers.get("content-type")?.match(/charset=([^;]+)/i)?.[1]?.toLowerCase() || "";
  const encoding = charset.includes("gb") ? "gb18030" : "utf-8";
  return new TextDecoder(encoding).decode(buffer);
}

async function fetchWithTimeout(url: string, signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("请求超时")), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  try {
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI Aggregator PPT Template Importer)",
        Accept: "*/*",
      },
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function runCommand(command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let output = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("解压 PPT 模板超时。"));
    }, timeoutMs);
    const abort = () => {
      proc.kill();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("用户已停止生成"));
    };
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString("utf-8");
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`解压 PPT 模板失败：${output.slice(-2000)}`));
    });
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function extractYppptAid(url: URL) {
  if (url.pathname === "/p/d.php") {
    const aid = url.searchParams.get("aid") || "";
    return /^\d+$/.test(aid) ? aid : "";
  }
  const match = url.pathname.match(/\/article\/(?:\d+\/)?(\d+)\.html$/);
  return match?.[1] || "";
}

function isSupportedDownloadPath(pathname: string) {
  const ext = extname(pathname).toLowerCase();
  return ARCHIVE_EXTENSIONS.has(ext) || OOXML_TEMPLATE_EXTENSIONS.has(ext) || LEGACY_TEMPLATE_EXTENSIONS.has(ext);
}

function parseUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function safeFilename(value: string, fallback: string) {
  const filename = basename(value || fallback).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120);
  return filename || fallback;
}

function decodeFilename(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}
