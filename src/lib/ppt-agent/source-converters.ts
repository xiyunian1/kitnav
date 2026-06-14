import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { dirname, extname, resolve, sep } from "path";
import { spawn } from "child_process";
import { isIP } from "net";
import { getPptMasterSkillDir } from "./runtime-paths";

const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";
const PPT_UPLOAD_ROOT = resolve(process.cwd(), "data", "ppt-uploads");

const DOCUMENT_CONVERTERS: Record<string, { script: string[]; extraArgs?: string[] }> = {
  ".pdf": { script: ["source_to_md", "pdf_to_md.py"] },
  ".docx": { script: ["source_to_md", "doc_to_md.py"] },
  ".html": { script: ["source_to_md", "doc_to_md.py"] },
  ".htm": { script: ["source_to_md", "doc_to_md.py"] },
  ".epub": { script: ["source_to_md", "doc_to_md.py"] },
  ".ipynb": { script: ["source_to_md", "doc_to_md.py"] },
  ".pptx": { script: ["source_to_md", "ppt_to_md.py"] },
  ".pptm": { script: ["source_to_md", "ppt_to_md.py"] },
  ".ppsx": { script: ["source_to_md", "ppt_to_md.py"] },
  ".ppsm": { script: ["source_to_md", "ppt_to_md.py"] },
  ".potx": { script: ["source_to_md", "ppt_to_md.py"] },
  ".potm": { script: ["source_to_md", "ppt_to_md.py"] },
  ".xlsx": { script: ["source_to_md", "excel_to_md.py"] },
  ".xlsm": { script: ["source_to_md", "excel_to_md.py"] },
};

export function getPptUploadRoot() {
  return PPT_UPLOAD_ROOT;
}

export async function convertDocumentToMarkdown(inputPath: string, outputPath: string) {
  const resolvedInput = resolve(inputPath);
  assertInsideUploadRoot(resolvedInput);
  if (!existsSync(resolvedInput)) throw new Error("上传文档不存在，请重新上传。");

  const ext = extname(resolvedInput).toLowerCase();
  const converter = DOCUMENT_CONVERTERS[ext];
  if (!converter) throw new Error("不支持的 PPT 文档格式。");

  await mkdir(dirname(outputPath), { recursive: true });
  const scriptPath = resolve(getPptMasterSkillDir(), "scripts", ...converter.script);
  await executePython(scriptPath, [resolvedInput, "-o", outputPath], 300_000);
  return readConvertedMarkdown(outputPath);
}

export async function convertUrlToMarkdownFile(url: string, outputPath: string) {
  assertSafePublicUrl(url);
  await mkdir(dirname(outputPath), { recursive: true });
  const scriptPath = resolve(getPptMasterSkillDir(), "scripts", "source_to_md", "web_to_md.py");
  await executePython(scriptPath, [url, "-o", outputPath], 180_000);
  return readConvertedMarkdown(outputPath);
}

function assertSafePublicUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("网页 URL 格式不正确。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("网页 URL 只支持 http 或 https。");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("不支持抓取本机地址。");
  }
  if (isPrivateHost(host)) {
    throw new Error("不支持抓取内网地址。");
  }
}

function isPrivateHost(host: string) {
  if (host === "0.0.0.0" || host === "::1") return true;
  const kind = isIP(host);
  if (kind === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  if (kind === 6) {
    return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}

function readConvertedMarkdown(outputPath: string) {
  const text = readFileSync(outputPath, "utf-8").trim();
  if (!text) throw new Error("文档转换后没有可用内容。");
  return text;
}

function assertInsideUploadRoot(path: string) {
  const root = PPT_UPLOAD_ROOT.endsWith(sep) ? PPT_UPLOAD_ROOT : `${PPT_UPLOAD_ROOT}${sep}`;
  if (path !== PPT_UPLOAD_ROOT && !path.startsWith(root)) {
    throw new Error("上传文档路径非法。");
  }
}

async function executePython(scriptPath: string, args: string[], timeoutMs: number) {
  return new Promise<void>((resolvePromise, reject) => {
    const proc = spawn(PYTHON_CMD, [scriptPath, ...args], {
      cwd: getPptMasterSkillDir(),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`文档转换超时：${scriptPath}`));
    }, timeoutMs);
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`文档转换失败：${(stderr || stdout).slice(0, 4000)}`));
    });
  });
}
