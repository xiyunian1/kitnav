import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	collectConvertedSourceImages,
	readConvertedMarkdown,
} from "./source-converters";

let root = "";

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "ppt-converted-source-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("readConvertedMarkdown", () => {
	it("returns non-empty converted text", async () => {
		const path = join(root, "source.md");
		await writeFile(path, "# Source\n\nContent\n");

		expect(readConvertedMarkdown(path)).toBe("# Source\n\nContent");
	});

	it("rejects and removes oversized converted output", async () => {
		const path = join(root, "source.md");
		await writeFile(path, Buffer.alloc(1024 * 1024 + 1, 0x61));

		expect(() => readConvertedMarkdown(path)).toThrow("文字内容过多");
		expect(existsSync(path)).toBe(false);
	});

	it("copies extracted document images into the project image pool", async () => {
		const markdownPath = join(root, "sources", "document_01.md");
		const assetDir = join(root, "sources", "document_01_files");
		await mkdir(assetDir, { recursive: true });
		await writeFile(markdownPath, "![figure](document_01_files/chart.png)");
		await writeFile(join(assetDir, "chart.png"), Buffer.from("png"));
		await writeFile(join(assetDir, "image_manifest.json"), "{}");

		const copied = collectConvertedSourceImages(
			markdownPath,
			join(root, "images"),
			"source_01",
		);
		expect(copied).toHaveLength(1);
		expect(copied[0]).toMatch(/source_01_chart\.png$/);
		expect(existsSync(copied[0])).toBe(true);
	});

	it.skipIf(process.platform === "win32")(
		"ignores symbolic links in converted document assets",
		async () => {
			const markdownPath = join(root, "sources", "document_01.md");
			const assetDir = join(root, "sources", "document_01_files");
			const externalPath = join(root, "external.png");
			await mkdir(assetDir, { recursive: true });
			await writeFile(markdownPath, "![figure](document_01_files/chart.png)");
			await writeFile(externalPath, Buffer.from("external"));
			await symlink(externalPath, join(assetDir, "chart.png"));

			expect(
				collectConvertedSourceImages(
					markdownPath,
					join(root, "images"),
					"source_01",
				),
			).toEqual([]);
		},
	);
});
