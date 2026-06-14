import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { getPptMasterSkillDir } from "./runtime-paths";

const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";

function getScriptsDir() {
  return join(getPptMasterSkillDir(), ["scr", "ipts"].join(""));
}

export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executePptPython(scriptPath: string, args: string[], timeoutMs = 180_000): Promise<PythonResult> {
  if (!existsSync(scriptPath)) {
    throw new Error(`PPT Master script not found: ${scriptPath}`);
  }

  return new Promise((resolvePromise, reject) => {
    const proc = spawn(PYTHON_CMD, [scriptPath, ...args], {
      cwd: getPptMasterSkillDir(),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Python script timed out: ${scriptPath}`));
    }, timeoutMs);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise({ stdout, stderr, exitCode: code });
        return;
      }
      reject(new Error(`Python script failed with code ${code}: ${stderr || stdout}`));
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn Python: ${error.message}`));
    });
  });
}

export async function convertPdfToMarkdown(pdfPath: string): Promise<string> {
  const script = join(getScriptsDir(), "source_to_md", "pdf_to_md.py");
  const result = await executePptPython(script, [pdfPath]);
  return result.stdout;
}

export async function convertDocxToMarkdown(docxPath: string): Promise<string> {
  const script = join(getScriptsDir(), "source_to_md", "doc_to_md.py");
  const result = await executePptPython(script, [docxPath]);
  return result.stdout;
}

export async function convertUrlToMarkdown(url: string): Promise<string> {
  const script = join(getScriptsDir(), "source_to_md", "web_to_md.py");
  const result = await executePptPython(script, [url], 120_000);
  return result.stdout;
}

export async function convertSvgToPptx(projectPath: string): Promise<string> {
  const script = join(getScriptsDir(), "svg_to_pptx.py");
  const result = await executePptPython(script, [projectPath], 300_000);
  const match = result.stdout.match(/exports[\\/][^\r\n]+\.pptx/i);
  if (!match) {
    throw new Error("PPTX path not found in svg_to_pptx output");
  }
  return join(projectPath, match[0]);
}

export async function splitNotes(projectPath: string): Promise<void> {
  const script = join(getScriptsDir(), "total_md_split.py");
  await executePptPython(script, [projectPath]);
}

export async function finalizeSvg(projectPath: string): Promise<void> {
  const script = join(getScriptsDir(), "finalize_svg.py");
  await executePptPython(script, [projectPath], 300_000);
}

export async function checkSvgQuality(projectPath: string): Promise<{ errors: string[]; warnings: string[] }> {
  const script = join(getScriptsDir(), "svg_quality_checker.py");
  try {
    const result = await executePptPython(script, [projectPath]);
    const errors = result.stdout.match(/ERROR:.*$/gm) || [];
    const warnings = result.stdout.match(/WARNING:.*$/gm) || [];
    return {
      errors: errors.map((item) => item.replace(/^ERROR:\s*/, "")),
      warnings: warnings.map((item) => item.replace(/^WARNING:\s*/, "")),
    };
  } catch (error) {
    return {
      errors: [error instanceof Error ? error.message : "SVG quality check failed"],
      warnings: [],
    };
  }
}
