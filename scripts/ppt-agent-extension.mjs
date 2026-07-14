import { spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { Type } from "typebox";
import {
  assertProjectPathAccess,
  isProtectedProjectPath,
  parseSafePythonCommand,
  resolveInsideRoot,
} from "./ppt-agent-extension-core.mjs";

const MAX_READ_BYTES = 600_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_CHARS = 2_000_000;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_TOOL_OUTPUT = 50_000;

export default function registerPptAgentExtension(pi) {
  const configuredProjectRoot = process.env.PPT_AGENT_PROJECT_DIR || process.cwd();
  const projectRoot = resolveInsideRoot(configuredProjectRoot, ".", { mustExist: true });
  const skillRoot = resolveInsideRoot(
    projectRoot,
    process.env.PPT_MASTER_SKILL_DIR || `${projectRoot}/.ppt-master-skill`,
    { mustExist: true },
  );

  pi.registerTool({
    name: "read",
    label: "Read PPT file",
    description: "Read a UTF-8 text file inside the current PPT project.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const path = resolveProjectPath(projectRoot, params.path, { mustExist: true });
      const info = statSync(path);
      if (!info.isFile()) throw new Error("Path is not a readable file");
      const imageMimeType = detectImageMimeType(readFileHeader(path));
      if (imageMimeType) {
        if (info.size > MAX_IMAGE_BYTES) throw new Error("Image is too large");
        const buffer = readFileSync(path);
        return {
          content: [
            { type: "text", text: `Read image file [${imageMimeType}]` },
            { type: "image", data: buffer.toString("base64"), mimeType: imageMimeType },
          ],
          details: {},
        };
      }
      if (info.size > MAX_READ_BYTES) throw new Error("File is too large");
      const buffer = readFileSync(path);
      const lines = buffer.toString("utf-8").split("\n");
      const offset = Math.max(1, Math.floor(params.offset || 1));
      const limit = Math.min(2000, Math.max(1, Math.floor(params.limit || 2000)));
      return toolText(lines.slice(offset - 1, offset - 1 + limit).join("\n"));
    },
  });

  pi.registerTool({
    name: "write",
    label: "Write PPT file",
    description: "Write a UTF-8 file inside the current PPT project.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(_id, params) {
      if (
        params.content.length > MAX_WRITE_CHARS ||
        Buffer.byteLength(params.content, "utf-8") > MAX_WRITE_BYTES
      ) throw new Error("File content is too large");
      const path = resolveProjectPath(projectRoot, params.path, { write: true });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, params.content, "utf-8");
      return toolText(`Wrote ${relative(projectRoot, path)} (${params.content.length} chars)`);
    },
  });

  pi.registerTool({
    name: "edit",
    label: "Edit PPT file",
    description: "Replace one exact text occurrence in a UTF-8 project file.",
    parameters: Type.Object({
      path: Type.String(),
      oldText: Type.String(),
      newText: Type.String(),
    }),
    async execute(_id, params) {
      const path = resolveProjectPath(projectRoot, params.path, {
        mustExist: true,
        write: true,
      });
      const info = statSync(path);
      if (!info.isFile() || info.size > MAX_WRITE_BYTES) {
        throw new Error("File is too large to edit");
      }
      const content = readFileSync(path, "utf-8");
      const first = content.indexOf(params.oldText);
      if (first < 0) throw new Error("oldText was not found");
      if (content.indexOf(params.oldText, first + params.oldText.length) >= 0) {
        throw new Error("oldText is not unique");
      }
      const updated = `${content.slice(0, first)}${params.newText}${content.slice(first + params.oldText.length)}`;
      if (
        updated.length > MAX_WRITE_CHARS ||
        Buffer.byteLength(updated, "utf-8") > MAX_WRITE_BYTES
      ) throw new Error("Edited file is too large");
      writeFileSync(path, updated, "utf-8");
      return toolText(`Edited ${relative(projectRoot, path)}`);
    },
  });

  pi.registerTool({
    name: "ls",
    label: "List PPT directory",
    description: "List files in a directory inside the current PPT project.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const path = resolveProjectPath(projectRoot, params.path || ".", { mustExist: true });
      const entries = readdirSync(path, { withFileTypes: true })
        .filter((entry) => !isProtectedProjectPath(`${path}/${entry.name}`, projectRoot))
        .slice(0, 500);
      return toolText(entries.map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`).join("\n"));
    },
  });

  pi.registerTool({
    name: "find",
    label: "Find PPT files",
    description: "Find project files by a simple glob pattern.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const root = resolveProjectPath(projectRoot, params.path || ".", { mustExist: true });
      const matcher = globToRegExp(params.pattern.slice(0, 200));
      const matches = walkFiles(
        root,
        Math.min(500, Math.max(1, params.limit || 200)),
        projectRoot,
      )
        .map((path) => relative(projectRoot, path).replaceAll("\\", "/"))
        .filter((path) => matcher.test(path));
      return toolText(matches.join("\n"));
    },
  });

  pi.registerTool({
    name: "grep",
    label: "Search PPT files",
    description: "Search UTF-8 project files with a regular expression.",
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      glob: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      const root = resolveProjectPath(projectRoot, params.path || ".", { mustExist: true });
      const pattern = new RegExp(params.pattern.slice(0, 200), "u");
      const fileMatcher = params.glob ? globToRegExp(params.glob.slice(0, 200)) : null;
      const limit = Math.min(500, Math.max(1, params.limit || 200));
      const output = [];
      for (const path of walkFiles(root, 3000, projectRoot)) {
        const relativePath = relative(projectRoot, path).replaceAll("\\", "/");
        if (fileMatcher && !fileMatcher.test(relativePath)) continue;
        const info = statSync(path);
        if (info.size > MAX_READ_BYTES) continue;
        const lines = readFileSync(path, "utf-8").split("\n");
        for (const [index, line] of lines.entries()) {
          pattern.lastIndex = 0;
          if (pattern.test(line)) output.push(`${relativePath}:${index + 1}:${line}`);
          if (output.length >= limit) return toolText(output.join("\n"));
        }
      }
      return toolText(output.join("\n"));
    },
  });

  pi.registerTool({
    name: "bash",
    label: "Run approved PPT script",
    description: "Run one approved PPT Master Python script. Shell operators, arbitrary programs, URLs, and paths outside this project are rejected.",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(_id, params, signal) {
      const parsed = parseSafePythonCommand(params.command, {
        projectRoot,
        skillRoot,
        pythonCommand: process.env.PPT_PYTHON_CMD,
      });
      const timeoutMs = Math.min(600_000, Math.max(1_000, Number(params.timeout || 300) * 1000));
      return toolText(await runProcess(parsed.executable, parsed.args, projectRoot, timeoutMs, signal));
    },
  });
}

function toolText(value) {
  return {
    content: [{ type: "text", text: String(value || "").slice(-MAX_TOOL_OUTPUT) }],
    details: {},
  };
}

function resolveProjectPath(projectRoot, inputPath, options) {
  const path = resolveInsideRoot(projectRoot, inputPath, options);
  assertProjectPathAccess(path, projectRoot, { write: Boolean(options?.write) });
  return path;
}

function walkFiles(root, limit, projectRoot) {
  const output = [];
  const queue = [root];
  while (queue.length > 0 && output.length < limit) {
    const directory = queue.shift();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolveInsideRoot(root, `${directory}/${entry.name}`, { mustExist: true });
      if (isProtectedProjectPath(path, projectRoot)) continue;
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) output.push(path);
      if (output.length >= limit) break;
    }
  }
  return output;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replaceAll("**", "\0").replaceAll("*", "[^/]*").replaceAll("\0", ".*").replaceAll("?", ".");
  return new RegExp(`^(?:${pattern})$`, "u");
}

function detectImageMimeType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  const gifHeader = buffer.subarray(0, 6).toString("ascii");
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
  return null;
}

function readFileHeader(path) {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(12);
    const bytesRead = readSync(file, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    closeSync(file);
  }
}

function sendProcessSignal(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when its process group is already gone.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the state check and the signal.
  }
}

function terminateProcessTree(child) {
  sendProcessSignal(child, "SIGTERM");
  const forceKill = setTimeout(() => sendProcessSignal(child, "SIGKILL"), 2_000);
  forceKill.unref();
  child.once("close", () => clearTimeout(forceKill));
}

function runProcess(command, args, cwd, timeoutMs, signal) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let output = "";
    let settled = false;
    const append = (chunk) => {
      output = `${output}${chunk.toString("utf-8")}`.slice(-MAX_TOOL_OUTPUT);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolvePromise(output);
    };
    const abort = () => {
      terminateProcessTree(child);
      finish(new Error("PPT script was cancelled"));
    };
    const timer = setTimeout(() => {
      terminateProcessTree(child);
      finish(new Error("PPT script timed out"));
    }, timeoutMs);
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", finish);
    child.on("close", (code) => finish(code === 0 ? undefined : new Error(`PPT script exited with ${code}: ${output}`)));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
