import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

interface ExtensionCore {
  assertProjectPathAccess(
    candidate: string,
    projectRoot: string,
    options?: { write?: boolean },
  ): void;
  resolveInsideRoot(
    root: string,
    inputPath: string,
    options?: { mustExist?: boolean },
  ): string;
  parseSafePythonCommand(
    command: string,
    options: { projectRoot: string; skillRoot: string; pythonCommand?: string },
  ): { executable: string; args: string[]; scriptName: string };
}

const coreModulePath = "../../../scripts/ppt-agent-extension-core.mjs";
const core = (await import(coreModulePath)) as ExtensionCore;

describe("PPT agent extension security", () => {
  let projectRoot: string;
  let skillRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ppt-agent-extension-"));
    skillRoot = join(projectRoot, ".ppt-master-skill");
    mkdirSync(join(skillRoot, "scripts"), { recursive: true });
    for (const script of ["finalize_svg.py", "svg_to_pptx.py", "unapproved.py"]) {
      writeFileSync(join(skillRoot, "scripts", script), "print('ok')\n", "utf-8");
    }
    mkdirSync(join(projectRoot, ".pi-agent"), { recursive: true });
    writeFileSync(join(projectRoot, ".pi-agent", "auth.json"), "secret", "utf-8");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("accepts one approved Python script with project-scoped paths", () => {
    const parsed = core.parseSafePythonCommand(
      'python3 "${SKILL_DIR}/scripts/finalize_svg.py" "${PROJECT_DIR}"',
      { projectRoot, skillRoot, pythonCommand: "/opt/ppt-venv/bin/python" },
    );

    expect(parsed.executable).toBe("/opt/ppt-venv/bin/python");
    expect(parsed.scriptName).toBe("finalize_svg.py");
    expect(parsed.args[1]).toBe(realpathSync(projectRoot));
  });

  it("never executes an interpreter path supplied by the agent", () => {
    const parsed = core.parseSafePythonCommand(
      './python3 "${SKILL_DIR}/scripts/finalize_svg.py" "${PROJECT_DIR}"',
      { projectRoot, skillRoot },
    );
    expect(parsed.executable).toBe("python3");
  });

  it.each([
    'python3 "${SKILL_DIR}/scripts/finalize_svg.py" .; cat /etc/passwd',
    "python3 -m http.server 8000",
    'python3 "${SKILL_DIR}/scripts/unapproved.py" .',
    'python3 "${SKILL_DIR}/scripts/finalize_svg.py" https://127.0.0.1/private',
    'python3 "${SKILL_DIR}/scripts/finalize_svg.py" .pi-agent/auth.json',
    'python3 "${SKILL_DIR}/scripts/finalize_svg.py" --output=/etc/passwd',
  ])("rejects unsafe commands: %s", (command) => {
    expect(() =>
      core.parseSafePythonCommand(command, { projectRoot, skillRoot }),
    ).toThrow();
  });

  it("rejects traversal and symlinks that escape the project", () => {
    expect(() => core.resolveInsideRoot(projectRoot, "../../etc/passwd")).toThrow(
      "outside",
    );

    const outside = mkdtempSync(join(tmpdir(), "ppt-agent-outside-"));
    try {
      symlinkSync(outside, join(projectRoot, "outside-link"));
      expect(() =>
        core.resolveInsideRoot(projectRoot, "outside-link/secret.txt"),
      ).toThrow("outside");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps agent config, sessions, and the executable skill copy protected", () => {
    expect(() =>
      core.assertProjectPathAccess(
        join(projectRoot, ".pi-agent", "auth.json"),
        projectRoot,
      ),
    ).toThrow("not accessible");
    expect(() =>
      core.assertProjectPathAccess(
        join(skillRoot, "scripts", "finalize_svg.py"),
        projectRoot,
        { write: true },
      ),
    ).toThrow("read-only");
    expect(() =>
      core.parseSafePythonCommand(
        'python3 "${SKILL_DIR}/scripts/finalize_svg.py" --output="${SKILL_DIR}/scripts/finalize_svg.py"',
        { projectRoot, skillRoot },
      ),
    ).toThrow("PPT skill files");
  });
});
