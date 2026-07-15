import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizePptSpecLock } from "./artifacts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("normalizePptSpecLock", () => {
  it("removes planning metadata from the typography execution contract", () => {
    const projectDir = mkdtempSync(join(tmpdir(), "ppt-spec-lock-"));
    temporaryDirectories.push(projectDir);
    mkdirSync(join(projectDir, "svg_output"));
    const specLockPath = join(projectDir, "spec_lock.md");
    writeFileSync(
      specLockPath,
      [
        "# Execution Lock",
        "",
        "## typography",
        '- font_family: Arial, "Microsoft YaHei", sans-serif',
        "- body: 24",
        "- title: 42",
        "- formula_policy: text-only",
        "- body_size_unit: px",
        "",
        "## images",
        "- cover: images/cover.png",
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(normalizePptSpecLock(projectDir)).toBe(2);
    expect(readFileSync(specLockPath, "utf-8")).toBe(
      [
        "# Execution Lock",
        "",
        "## typography",
        '- font_family: Arial, "Microsoft YaHei", sans-serif',
        "- body: 24",
        "- title: 42",
        "",
        "## images",
        "- cover: images/cover.png",
        "",
      ].join("\n"),
    );
    expect(normalizePptSpecLock(projectDir)).toBe(0);
  });
});
