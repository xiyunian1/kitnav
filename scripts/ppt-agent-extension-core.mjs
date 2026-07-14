import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const ALLOWED_PPT_SCRIPTS = new Set([
  "analyze_images.py",
  "animation_config.py",
  "finalize_svg.py",
  "icon_sync.py",
  "latex_render.py",
  "slice_images.py",
  "source_to_md/ppt_to_md.py",
  "svg_quality_checker.py",
  "svg_to_pptx.py",
  "template_fill_pptx.py",
  "total_md_split.py",
]);

export function isProtectedProjectPath(candidate, projectRoot, options = {}) {
  const resolvedRoot = realpathSync(resolve(projectRoot));
  let resolvedCandidate;
  try {
    resolvedCandidate = resolveInsideRoot(resolvedRoot, candidate);
  } catch {
    return true;
  }
  const projectRelative = relative(resolvedRoot, resolvedCandidate).replaceAll(sep, "/");
  const topLevel = projectRelative.split("/", 1)[0];
  return (
    topLevel === ".pi-agent" ||
    topLevel === ".pi-sessions" ||
    (options.write && topLevel === ".ppt-master-skill")
  );
}

export function assertProjectPathAccess(candidate, projectRoot, options = {}) {
  if (isProtectedProjectPath(candidate, projectRoot, options)) {
    throw new Error(
      options.write
        ? "Agent configuration, sessions, and PPT skill files are read-only"
        : "Agent configuration and session files are not accessible to tools",
    );
  }
}

export function resolveInsideRoot(root, inputPath, options = {}) {
  if (typeof inputPath !== "string" || !inputPath.trim() || inputPath.includes("\0")) {
    throw new Error("Path is required");
  }
  const resolvedRoot = realpathSync(resolve(root));
  const candidate = resolve(root, inputPath);

  if (existsSync(candidate)) {
    const real = realpathSync(candidate);
    assertInside(real, resolvedRoot);
    return real;
  }
  if (options.mustExist) throw new Error(`Path does not exist: ${inputPath}`);

  let ancestor = candidate;
  const missingParts = [];
  while (!existsSync(ancestor)) {
    missingParts.push(basename(ancestor));
    const parent = resolve(ancestor, "..");
    if (parent === ancestor) throw new Error("Unable to resolve path parent");
    ancestor = parent;
  }
  const realAncestor = realpathSync(ancestor);
  assertInside(realAncestor, resolvedRoot);
  return resolve(realAncestor, ...missingParts.reverse());
}

export function parseSafePythonCommand(command, options) {
  if (typeof command !== "string" || !command.trim()) {
    throw new Error("Command is required");
  }
  const normalized = command
    .replace(/\\\r?\n/g, " ")
    .replaceAll("${SKILL_DIR}", options.skillRoot)
    .replaceAll("$SKILL_DIR", options.skillRoot)
    .replaceAll("${PROJECT_DIR}", options.projectRoot)
    .replaceAll("$PROJECT_DIR", options.projectRoot);
  if (/[\r\n]/.test(normalized)) throw new Error("Multiple commands are not allowed");
  const tokens = tokenizeCommand(normalized);
  if (tokens.length < 2) throw new Error("Only PPT Master Python scripts are allowed");

  const executable = tokens[0];
  const executableName = basename(executable).toLowerCase();
  if (executableName !== "python" && executableName !== "python3") {
    throw new Error("Only Python PPT Master scripts are allowed");
  }
  if (tokens[1] === "-m" || tokens[1].startsWith("-")) {
    throw new Error("Python modules and interpreter options are not allowed");
  }

  const projectRoot = realpathSync(resolve(options.projectRoot));
  const skillRoot = realpathSync(resolve(options.skillRoot));
  assertInside(skillRoot, projectRoot);
  const scriptRoot = realpathSync(resolve(skillRoot, "scripts"));
  const scriptPath = resolveScriptPath(tokens[1], projectRoot, skillRoot, scriptRoot);
  const scriptName = relative(scriptRoot, scriptPath).replaceAll(sep, "/");
  if (!ALLOWED_PPT_SCRIPTS.has(scriptName)) {
    throw new Error(`PPT script is not allowed: ${scriptName}`);
  }

  const args = tokens.slice(2).map((value) =>
    normalizeScriptArgument(value, projectRoot, skillRoot),
  );
  return {
    executable: options.pythonCommand || "python3",
    args: [scriptPath, ...args],
    scriptName,
  };
}

function resolveScriptPath(value, projectRoot, skillRoot, scriptRoot) {
  const expanded = value
    .replaceAll("${SKILL_DIR}", skillRoot)
    .replaceAll("$SKILL_DIR", skillRoot);
  let candidate;
  if (isAbsolute(expanded)) {
    candidate = resolve(expanded);
  } else {
    const normalized = expanded.replaceAll("\\", "/");
    const scriptsIndex = normalized.lastIndexOf("/scripts/");
    if (normalized.startsWith("scripts/")) {
      candidate = resolve(skillRoot, normalized);
    } else if (scriptsIndex >= 0) {
      candidate = resolve(scriptRoot, normalized.slice(scriptsIndex + 9));
    } else {
      candidate = resolve(projectRoot, normalized);
    }
  }
  const real = resolveInsideRoot(scriptRoot, candidate, { mustExist: true });
  return real;
}

function normalizeScriptArgument(value, projectRoot, skillRoot) {
  if (!value || value.includes("\0")) return value;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.startsWith("data:")) {
    throw new Error("Network URLs are not allowed in PPT script arguments");
  }

  const equalsIndex = value.indexOf("=");
  if (value.startsWith("-") && equalsIndex > 0) {
    const name = value.slice(0, equalsIndex + 1);
    return `${name}${normalizePathLikeValue(value.slice(equalsIndex + 1), projectRoot, skillRoot)}`;
  }
  return normalizePathLikeValue(value, projectRoot, skillRoot);
}

function normalizePathLikeValue(value, projectRoot, skillRoot) {
  const expanded = value
    .replaceAll("${SKILL_DIR}", skillRoot)
    .replaceAll("$SKILL_DIR", skillRoot)
    .replaceAll("${PROJECT_DIR}", projectRoot)
    .replaceAll("$PROJECT_DIR", projectRoot);
  const candidate = resolve(projectRoot, expanded);
  const path = resolveInsideRoot(projectRoot, expanded);
  assertNotSensitiveProjectPath(path, projectRoot, skillRoot);
  if (
    isAbsolute(expanded) ||
    existsSync(candidate) ||
    expanded === ".." ||
    expanded.startsWith("../") ||
    expanded.includes("/../")
  ) return path;
  return expanded;
}

function assertNotSensitiveProjectPath(candidate, projectRoot, skillRoot) {
  assertProjectPathAccess(candidate, projectRoot, { write: true });
  if (candidate === skillRoot || candidate.startsWith(`${skillRoot}${sep}`)) {
    throw new Error("PPT skill files cannot be passed as script inputs or outputs");
  }
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    if (";&|<>`".includes(char) || char === "$") {
      throw new Error("Shell operators and substitutions are not allowed");
    }
    current += char;
  }
  if (escaped || quote) throw new Error("Command quoting is incomplete");
  if (current) tokens.push(current);
  return tokens;
}

function assertInside(candidate, root) {
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error("Path is outside the PPT project directory");
  }
}
