import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateRestoredFileRoots,
  activateStagingDatabase,
  rollbackRestoredFileRoots,
} from "../../scripts/restore-cutover-utils";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "restore-cutover-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("restore cutover", () => {
  it("can roll activated file roots back to their previous contents", async () => {
    const dataDir = join(root, "data");
    const stagingDir = join(root, "staging");
    await mkdir(join(dataDir, "uploads"), { recursive: true });
    await mkdir(join(stagingDir, "uploads"), { recursive: true });
    await writeFile(join(dataDir, "uploads", "value.txt"), "old");
    await writeFile(join(stagingDir, "uploads", "value.txt"), "new");

    const activated = await activateRestoredFileRoots({
      includedPaths: ["uploads"],
      stagingDir,
      dataDir,
      stamp: "20260713000000",
    });
    expect(await readFile(join(dataDir, "uploads", "value.txt"), "utf8")).toBe(
      "new",
    );

    await rollbackRestoredFileRoots(activated);
    expect(await readFile(join(dataDir, "uploads", "value.txt"), "utf8")).toBe(
      "old",
    );
  });

  it("rolls back earlier roots when a later file activation fails", async () => {
    const dataDir = join(root, "data");
    const stagingDir = join(root, "staging");
    await mkdir(join(dataDir, "uploads"), { recursive: true });
    await mkdir(join(dataDir, "ppt-projects"), { recursive: true });
    await mkdir(join(stagingDir, "uploads"), { recursive: true });
    await writeFile(join(dataDir, "uploads", "value.txt"), "old-upload");
    await writeFile(join(dataDir, "ppt-projects", "value.txt"), "old-ppt");
    await writeFile(join(stagingDir, "uploads", "value.txt"), "new-upload");

    await expect(
      activateRestoredFileRoots({
        includedPaths: ["uploads", "ppt-projects"],
        stagingDir,
        dataDir,
        stamp: "20260713000001",
      }),
    ).rejects.toThrow();
    expect(await readFile(join(dataDir, "uploads", "value.txt"), "utf8")).toBe(
      "old-upload",
    );
    expect(
      await readFile(join(dataDir, "ppt-projects", "value.txt"), "utf8"),
    ).toBe("old-ppt");
  });

  it("restores the previous database when staging activation fails", async () => {
    const renameTargetToPrevious = vi.fn(async () => undefined);
    const activateStaging = vi.fn(async () => {
      throw new Error("activation failed");
    });
    const restorePrevious = vi.fn(async () => undefined);

    await expect(
      activateStagingDatabase({
        targetExists: true,
        renameTargetToPrevious,
        activateStaging,
        restorePrevious,
      }),
    ).rejects.toThrow("activation failed");
    expect(renameTargetToPrevious).toHaveBeenCalledOnce();
    expect(restorePrevious).toHaveBeenCalledOnce();
  });
});
