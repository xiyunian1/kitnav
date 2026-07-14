import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConvertedMarkdown } from "./source-converters";

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
});
