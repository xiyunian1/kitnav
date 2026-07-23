import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFile } from "node:process";
import sharp from "sharp";

interface Baseline {
  version: 1;
  minimumChannelStdev: number;
  templates: Record<string, number>;
}

function findPython() {
  const candidates = [
    process.env.PPT_PYTHON_CMD,
    process.env.PPT_PYTHON_BIN,
    "/opt/ppt-venv/bin/python3",
    ...(process.platform === "win32"
      ? ["python"]
      : ["python3.13", "python3.12", "python3.11", "python3.10", "python3"]),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    const version = `${result.stdout || ""}${result.stderr || ""}`.match(
      /Python\s+(\d+)\.(\d+)/,
    );
    if (
      result.status === 0 &&
      version &&
      (Number(version[1]) > 3 ||
        (Number(version[1]) === 3 && Number(version[2]) >= 10))
    ) {
      return candidate;
    }
  }
  throw new Error(
    "PPT quality regression requires Python 3.10 or newer; set PPT_PYTHON_CMD",
  );
}

async function templateDirectories(root: string) {
  const output: string[] = [];
  for (const kind of ["layouts", "decks"]) {
    const entries = await readdir(join(root, kind), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) output.push(`${kind}/${entry.name}`);
    }
  }
  return output.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

async function main() {
  const repositoryRoot = resolve(import.meta.dirname, "..");
  for (const filename of [".env", ".env.local"]) {
    const path = join(repositoryRoot, filename);
    if (existsSync(path)) loadEnvFile(path);
  }
  const templateRoot = join(
    repositoryRoot,
    "scripts",
    "ppt-master",
    "templates",
  );
  const baseline = JSON.parse(
    await readFile(
      join(repositoryRoot, "scripts", "ppt-quality-baseline.json"),
      "utf8",
    ),
  ) as Baseline;
  if (
    baseline.version !== 1 ||
    !Number.isFinite(baseline.minimumChannelStdev) ||
    baseline.minimumChannelStdev <= 0
  ) {
    throw new Error("PPT quality baseline is invalid");
  }

  const expected = Object.keys(baseline.templates).sort((left, right) =>
    left.localeCompare(right, "zh-CN"),
  );
  const actual = await templateDirectories(templateRoot);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `PPT template roster changed. Expected ${expected.join(", ")}; found ${actual.join(", ")}`,
    );
  }

  const python = findPython();
  const checker = join(
    repositoryRoot,
    "scripts",
    "ppt-master",
    "scripts",
    "svg_quality_checker.py",
  );
  let rendered = 0;
  const stagingRoot = await mkdtemp(join(tmpdir(), "ppt-quality-regression-"));
  try {
    const placeholder = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 220, g: 224, b: 230, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    for (const relative of expected) {
      const sourceDirectory = join(templateRoot, relative);
      const directory = join(stagingRoot, relative);
      await cp(sourceDirectory, directory, { recursive: true });
      await writeFile(join(directory, "__placeholder.png"), placeholder);
      const svgFiles = (await readdir(directory))
        .filter((file) => file.toLowerCase().endsWith(".svg"))
        .sort((left, right) =>
          left.localeCompare(right, "zh-CN", { numeric: true }),
        );
      if (svgFiles.length !== baseline.templates[relative]) {
        throw new Error(
          `${relative} expected ${baseline.templates[relative]} SVG files, found ${svgFiles.length}`,
        );
      }
      for (const svgFile of svgFiles) {
        const path = join(directory, svgFile);
        const content = await readFile(path, "utf8");
        await writeFile(
          path,
          content.replace(
            /((?:href|xlink:href)=["'])[^"']*\{\{[^"']+\}\}(["'])/g,
            "$1__placeholder.png$2",
          ),
        );
      }
      const pageSvgFiles = svgFiles.filter((file) => /^\d/.test(file));
      for (const helperSvg of svgFiles.filter((file) => !/^\d/.test(file))) {
        await rm(join(directory, helperSvg), { force: true });
      }
      const quality = spawnSync(
        python,
        [checker, directory, "--template-mode"],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      if (quality.status !== 0) {
        process.stderr.write(quality.stdout || "");
        process.stderr.write(quality.stderr || "");
        throw new Error(`PPT SVG quality checker failed for ${relative}`);
      }

      for (const svgFile of pageSvgFiles) {
        const stats = await sharp(join(directory, svgFile), {
          density: 96,
          limitInputPixels: 100_000_000,
        })
          .flatten({ background: "#ffffff" })
          .resize(320, 180, { fit: "fill" })
          .stats();
        if (
          stats.channels.every(
            (channel) => channel.stdev < baseline.minimumChannelStdev,
          )
        ) {
          throw new Error(`PPT template rendered blank: ${relative}/${svgFile}`);
        }
        rendered += 1;
      }
    }
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  console.log(
    `PPT quality regression passed: ${expected.length} templates, ${rendered} rendered SVG pages.`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
