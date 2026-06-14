import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve, sep } from "path";
import { spawn } from "child_process";
import { getPptMasterSkillDir } from "./runtime-paths";
import type { ToolDefinition } from "@/lib/providers/text-openai";

const PYTHON_CMD = process.platform === "win32" ? "python" : "python3";
const ALLOWED_SCRIPT_NAMES = new Set([
  "svg_quality_checker.py",
  "total_md_split.py",
  "finalize_svg.py",
  "svg_to_pptx.py",
]);

export const PPT_AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the current PPT project or ppt-master skill directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 file under the current PPT project directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files under the current PPT project or ppt-master skill directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quality_check",
      description: "Run the PPT Master SVG quality checker on the current project.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_ppt_script",
      description: "Run a whitelisted ppt-master Python script against the current project.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", enum: Array.from(ALLOWED_SCRIPT_NAMES) },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["script"],
        additionalProperties: false,
      },
    },
  },
];

export class PptToolRuntime {
  private readonly projectDir: string;
  private readonly skillDir: string;
  private readonly signal?: AbortSignal;

  constructor(projectDir: string, signal?: AbortSignal) {
    this.projectDir = resolve(projectDir);
    this.skillDir = resolve(getPptMasterSkillDir());
    this.signal = signal;
  }

  async execute(name: string, rawArgs: string) {
    const args = parseToolArgs(rawArgs);
    if (name === "read_file") return this.readFile(requireString(args.path, "path"));
    if (name === "write_file") return this.writeFile(requireString(args.path, "path"), requireString(args.content, "content"));
    if (name === "list_dir") return this.listDir(requireString(args.path, "path"));
    if (name === "quality_check") return this.runPptScript("svg_quality_checker.py", [this.projectDir]);
    if (name === "run_ppt_script") {
      const script = requireString(args.script, "script");
      const scriptArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      return this.runPptScript(script, scriptArgs);
    }
    throw new Error(`Unsupported PPT tool: ${name}`);
  }

  readFile(path: string) {
    const resolved = this.resolveReadablePath(path);
    if (!existsSync(resolved)) throw new Error(`File not found: ${path}`);
    const info = statSync(resolved);
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    if (info.size > 600_000) throw new Error(`File too large to read through tool: ${path}`);
    return readFileSync(resolved, "utf-8");
  }

  writeFile(path: string, content: string) {
    const resolved = this.resolveProjectPath(path);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, content, "utf-8");
    return `File written: ${this.relativeToProject(resolved)} (${content.length} chars)`;
  }

  listDir(path: string) {
    const resolved = this.resolveReadablePath(path);
    if (!existsSync(resolved)) throw new Error(`Directory not found: ${path}`);
    const info = statSync(resolved);
    if (!info.isDirectory()) throw new Error(`Not a directory: ${path}`);
    return readdirSync(resolved)
      .slice(0, 200)
      .map((name) => {
        const item = join(resolved, name);
        const stat = statSync(item);
        return `${stat.isDirectory() ? "dir " : "file"} ${name}${stat.isFile() ? ` ${stat.size}B` : ""}`;
      })
      .join("\n");
  }

  async runPptScript(script: string, args: string[]) {
    if (!ALLOWED_SCRIPT_NAMES.has(script)) {
      throw new Error(`Script is not allowed: ${script}`);
    }
    const scriptPath = join(this.skillDir, ["scr", "ipts"].join(""), script);
    if (!existsSync(scriptPath)) throw new Error(`PPT script not found: ${script}`);
    const safeArgs = args.map((arg, index) => this.resolveScriptArg(arg, args[index - 1]));
    if (safeArgs.length === 0) safeArgs.push(this.projectDir);
    return executePython(scriptPath, safeArgs, this.signal);
  }

  private resolveScriptArg(arg: string, previousArg?: string) {
    if (arg === "{projectDir}") return this.projectDir;
    if (arg.startsWith("-")) return arg;
    if (previousArg === "-s" || previousArg === "--source") {
      if (arg === "output" || arg === "final" || arg === "svg_output" || arg === "svg_final") return arg;
      throw new Error(`Unsupported PPT script source argument: ${arg}`);
    }
    return this.resolveProjectPath(arg);
  }

  private resolveReadablePath(path: string) {
    const resolved = resolve(this.projectDir, path);
    if (isInside(resolved, this.projectDir) && existsSync(resolved)) return resolved;
    const skillRelative = resolve(this.skillDir, path);
    if (isInside(skillRelative, this.skillDir) && existsSync(skillRelative)) return skillRelative;
    if (isInside(resolved, this.projectDir)) return resolved;
    if (isInside(resolved, this.skillDir)) return resolved;
    throw new Error(`Path is outside allowed PPT directories: ${path}`);
  }

  private resolveProjectPath(path: string) {
    const resolved = resolve(this.projectDir, path);
    if (!isInside(resolved, this.projectDir)) {
      throw new Error(`Path is outside the PPT project directory: ${path}`);
    }
    return resolved;
  }

  private relativeToProject(path: string) {
    return relative(this.projectDir, path).replaceAll("\\", "/");
  }
}

function parseToolArgs(rawArgs: string) {
  try {
    const value = JSON.parse(rawArgs || "{}");
    if (value && typeof value === "object") return value as Record<string, unknown>;
  } catch {
    // handled below
  }
  throw new Error("Tool arguments must be a JSON object");
}

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing tool argument: ${name}`);
  return value;
}

function isInside(path: string, root: string) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return path === root || path.startsWith(normalizedRoot);
}

async function executePython(scriptPath: string, args: string[], signal?: AbortSignal) {
  return new Promise<string>((resolvePromise, reject) => {
    const proc = spawn(PYTHON_CMD, [scriptPath, ...args], {
      cwd: getPptMasterSkillDir(),
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`PPT script timed out: ${scriptPath}`));
    }, 300_000);
    const abort = () => {
      clearTimeout(timer);
      proc.kill();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("PPT generation was cancelled"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
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
        resolvePromise((stdout || stderr || "OK").slice(0, 10_000));
        return;
      }
      reject(new Error(`PPT script exited with ${code}: ${(stderr || stdout).slice(0, 4000)}`));
    });
  });
}
