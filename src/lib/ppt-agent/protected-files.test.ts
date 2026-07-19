import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	restoreAndRejectProtectedChanges,
	runWithProtectedFileGuard,
	snapshotDirectoryFiles,
	snapshotDirectoryTreeFiles,
	snapshotFileStates,
	snapshotFiles,
} from "./protected-files";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT protected file snapshots", () => {
	it("restores modified or deleted files and removes unexpected entries", () => {
		const root = createRoot();
		const directory = join(root, "svg_output");
		writeFileSync(join(directory, "01_slide.svg"), "one");
		writeFileSync(join(directory, "02_slide.svg"), "two");
		const snapshot = snapshotDirectoryFiles(directory);

		writeFileSync(join(directory, "01_slide.svg"), "changed");
		rmSync(join(directory, "02_slide.svg"));
		writeFileSync(join(directory, "03_slide.svg"), "unexpected");

		expect(() => restoreAndRejectProtectedChanges([], [snapshot])).toThrow(
			"越权修改了受保护文件",
		);
		expect(readFileSync(join(directory, "01_slide.svg"), "utf-8")).toBe("one");
		expect(readFileSync(join(directory, "02_slide.svg"), "utf-8")).toBe("two");
		expect(existsSync(join(directory, "03_slide.svg"))).toBe(false);
	});

	it("allows only explicitly assigned files to change inside a protected directory", () => {
		const root = createRoot();
		const directory = join(root, "svg_output");
		const assigned = join(directory, "01_slide.svg");
		const untouched = join(directory, "02_slide.svg");
		writeFileSync(assigned, "one");
		writeFileSync(untouched, "two");
		const snapshot = snapshotDirectoryFiles(directory, {
			allowChangesTo: [assigned],
		});

		writeFileSync(assigned, "reviewed");
		expect(() => restoreAndRejectProtectedChanges([], [snapshot])).not.toThrow();
		expect(readFileSync(assigned, "utf-8")).toBe("reviewed");
		expect(readFileSync(untouched, "utf-8")).toBe("two");
	});

	it("breaks a replacement hard link before restoring protected content", () => {
		const root = createRoot();
		const directory = join(root, "svg_output");
		const protectedPath = join(directory, "01_slide.svg");
		const externalPath = join(root, "external.txt");
		writeFileSync(protectedPath, "original");
		writeFileSync(externalPath, "external");
		const snapshot = snapshotDirectoryFiles(directory);

		rmSync(protectedPath);
		linkSync(externalPath, protectedPath);

		expect(() => restoreAndRejectProtectedChanges([], [snapshot])).toThrow(
			"越权修改了受保护文件",
		);
		expect(readFileSync(protectedPath, "utf-8")).toBe("original");
		expect(readFileSync(externalPath, "utf-8")).toBe("external");
	});

	it("rejects links before taking a protected snapshot", () => {
		const root = createRoot();
		const externalPath = join(root, "external.txt");
		const hardLinkPath = join(root, "hard-link.txt");
		const symbolicLinkPath = join(root, "symbolic-link.txt");
		writeFileSync(externalPath, "external");
		linkSync(externalPath, hardLinkPath);
		symlinkSync(externalPath, symbolicLinkPath);

		expect(() => snapshotFiles([hardLinkPath])).toThrow("非独占普通文件");
		expect(() => snapshotFiles([symbolicLinkPath])).toThrow("非独占普通文件");
	});

	it("restores protected files when the guarded operation fails", async () => {
		const root = createRoot();
		const directory = join(root, "svg_output");
		const protectedPath = join(directory, "01_slide.svg");
		writeFileSync(protectedPath, "original");
		const snapshot = snapshotDirectoryFiles(directory);

		await expect(
			runWithProtectedFileGuard(
				async () => {
					writeFileSync(protectedPath, "partial");
					throw new Error("provider failed");
				},
				[],
				[snapshot],
				"图表请求阶段",
			),
		).rejects.toThrow("执行失败且越权修改了受保护文件");
		expect(readFileSync(protectedPath, "utf-8")).toBe("original");
	});

	it("preserves the original failure when protected files are unchanged", async () => {
		const root = createRoot();
		const snapshot = snapshotDirectoryFiles(join(root, "svg_output"));

		await expect(
			runWithProtectedFileGuard(
				async () => {
					throw new Error("provider failed");
				},
				[],
				[snapshot],
			),
		).rejects.toThrow("provider failed");
	});

	it("removes a file that was absent when the protected phase started", async () => {
		const root = createRoot();
		const decisionPath = join(
			root,
			"analysis",
			"hosted_confirmation_result.json",
		);
		mkdirSync(join(root, "analysis"), { recursive: true });
		const snapshots = snapshotFileStates([decisionPath]);

		await expect(
			runWithProtectedFileGuard(async () => {
				writeFileSync(decisionPath, "forged");
			}, snapshots, [], "初始 Strategist"),
		).rejects.toThrow("越权修改了受保护文件");
		expect(existsSync(decisionPath)).toBe(false);
	});

	it("restores nested source files and removes unexpected tree entries", async () => {
		const root = createRoot();
		const sources = join(root, "sources");
		const originals = join(sources, "originals");
		mkdirSync(originals, { recursive: true });
		const sourcePath = join(sources, "source.md");
		const originalPath = join(originals, "source.pdf");
		writeFileSync(sourcePath, "source");
		writeFileSync(originalPath, "original");
		const snapshot = snapshotDirectoryTreeFiles(sources);

		await expect(
			runWithProtectedFileGuard(
				async () => {
					writeFileSync(sourcePath, "changed");
					rmSync(originalPath);
					mkdirSync(join(sources, "unexpected"));
					writeFileSync(join(sources, "unexpected", "data.txt"), "data");
				},
				[],
				[snapshot],
				"Executor",
			),
		).rejects.toThrow("越权修改了受保护文件");
		expect(readFileSync(sourcePath, "utf-8")).toBe("source");
		expect(readFileSync(originalPath, "utf-8")).toBe("original");
		expect(existsSync(join(sources, "unexpected"))).toBe(false);
	});

	it("allows an explicitly assigned file to be created in a protected tree", async () => {
		const root = createRoot();
		const images = join(root, "images");
		mkdirSync(images, { recursive: true });
		const manifestPath = join(images, "image_prompts.json");
		const snapshot = snapshotDirectoryTreeFiles(images, {
			allowChangesTo: [manifestPath],
		});

		await expect(
			runWithProtectedFileGuard(
				async () => writeFileSync(manifestPath, '{"items":[]}'),
				[],
				[snapshot],
			),
		).resolves.toBeUndefined();
		expect(readFileSync(manifestPath, "utf-8")).toBe('{"items":[]}');
	});

	it("rolls back an allowed file when the guarded operation fails", async () => {
		const root = createRoot();
		const images = join(root, "images");
		mkdirSync(images, { recursive: true });
		const manifestPath = join(images, "image_prompts.json");
		writeFileSync(manifestPath, "original");
		const directorySnapshot = snapshotDirectoryTreeFiles(images, {
			allowChangesTo: [manifestPath],
		});
		const rollbackSnapshot = snapshotFiles([manifestPath]);

		await expect(
			runWithProtectedFileGuard(
				async () => {
					writeFileSync(manifestPath, "partial");
					throw new Error("provider failed");
				},
				[],
				[directorySnapshot],
				"规划修订",
				{ rollbackFilesOnFailure: rollbackSnapshot },
			),
		).rejects.toThrow("provider failed");
		expect(readFileSync(manifestPath, "utf-8")).toBe("original");
	});
});

function createRoot() {
	const root = mkdtempSync(join(tmpdir(), "ppt-protected-files-"));
	roots.push(root);
	mkdirSync(join(root, "svg_output"), { recursive: true });
	return root;
}
