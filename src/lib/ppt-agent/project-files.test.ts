import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ppt-project-files-"));
  process.env.PPT_PROJECTS_ROOT = root;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.PPT_PROJECTS_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("PPT project file resolution", () => {
  it("resolves regular files inside the project", async () => {
    const file = join(root, "project_1", "svg_output", "slide.svg");
    await mkdir(join(root, "project_1", "svg_output"), { recursive: true });
    await writeFile(file, "<svg/>");
    const { resolvePptProjectFile } = await import("./paths");

    await expect(
      resolvePptProjectFile("project_1", "svg_output/slide.svg"),
    ).resolves.toMatchObject({ path: await realpath(file), size: 6 });
  });

  it("rejects files reached through an external symlink", async () => {
    const outside = join(root, "..", `outside-${Date.now()}.png`);
    const projectDir = join(root, "project_1", "images");
    await mkdir(projectDir, { recursive: true });
    await writeFile(outside, "private");
    await symlink(outside, join(projectDir, "preview.png"));
    const { resolvePptProjectFile } = await import("./paths");

    try {
      await expect(
        resolvePptProjectFile("project_1", "images/preview.png"),
      ).rejects.toThrow();
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("rejects a project directory that resolves outside the storage root", async () => {
    const outsideProject = await mkdtemp(join(tmpdir(), "ppt-outside-project-"));
    await writeFile(join(outsideProject, "deck.pptx"), "deck");
    await symlink(outsideProject, join(root, "project_1"));
    const { resolvePptProjectFile } = await import("./paths");

    try {
      await expect(
        resolvePptProjectFile("project_1", "deck.pptx"),
      ).rejects.toThrow("outside");
    } finally {
      await rm(outsideProject, { recursive: true, force: true });
    }
  });
});
