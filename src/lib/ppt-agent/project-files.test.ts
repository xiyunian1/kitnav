import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  utimes,
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

describe("PPT SVG previews", () => {
  it("returns regular SVG files in page order with cache revisions", async () => {
    const svgDir = join(root, "project_1", "svg_output");
    await mkdir(svgDir, { recursive: true });
    await writeFile(join(svgDir, "10_slide.svg"), "<svg>10</svg>");
    await writeFile(join(svgDir, "2_slide.svg"), "<svg>2</svg>");
    await writeFile(join(svgDir, "notes.txt"), "ignore");
    await mkdir(join(svgDir, "3_slide.svg"));
    await symlink("10_slide.svg", join(svgDir, "4_slide.svg"));
    await utimes(
      join(svgDir, "2_slide.svg"),
      new Date("2026-07-22T00:00:00.000Z"),
      new Date("2026-07-22T00:00:00.000Z"),
    );
    const { getProjectSvgPreviews } = await import("./paths");

    const previews = await getProjectSvgPreviews("project_1");

    expect(previews.map((preview) => preview.filename)).toEqual([
      "2_slide.svg",
      "10_slide.svg",
    ]);
    expect(previews[0]).toMatchObject({
      revision: `${Date.parse("2026-07-22T00:00:00.000Z")}-12`,
    });
    expect(previews[0]?.url).toContain(
      `2_slide.svg?v=${Date.parse("2026-07-22T00:00:00.000Z")}-12`,
    );
  });

  it("changes the revision when a generated page is rewritten", async () => {
    const svgDir = join(root, "project_1", "svg_output");
    const file = join(svgDir, "01_slide.svg");
    await mkdir(svgDir, { recursive: true });
    await writeFile(file, "<svg/>");
    await utimes(file, new Date(1_000), new Date(1_000));
    const { getProjectSvgPreviews } = await import("./paths");
    const before = await getProjectSvgPreviews("project_1");

    await writeFile(file, "<svg>fixed</svg>");
    await utimes(file, new Date(2_000), new Date(2_000));
    const after = await getProjectSvgPreviews("project_1");

    expect(after[0]?.revision).not.toBe(before[0]?.revision);
    expect(after[0]?.url).not.toBe(before[0]?.url);
  });
});
