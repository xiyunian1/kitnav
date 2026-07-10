import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	resolvePptGenerationWorkflow,
	stageNativePptTemplate,
} from "./workflow";

describe("PPT generation workflow", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("routes an explicitly uploaded template to native template fill", () => {
		expect(
			resolvePptGenerationWorkflow({ templateFileUrls: ["template.pptx"] }),
		).toBe("template-fill");
		expect(resolvePptGenerationWorkflow({ templateFileUrls: [] })).toBe("svg");
		expect(resolvePptGenerationWorkflow({})).toBe("svg");
	});

	it("stages the native template inside the project sources directory", () => {
		const root = mkdtempSync(join(tmpdir(), "ppt-template-fill-"));
		temporaryDirectories.push(root);
		const uploadDir = join(root, "uploads");
		const projectDir = join(root, "project");
		mkdirSync(uploadDir, { recursive: true });
		const uploadPath = join(uploadDir, "uploaded.pptx");
		writeFileSync(uploadPath, "fake-pptx");

		const staged = stageNativePptTemplate(projectDir, [uploadPath]);

		expect(staged.relativePath).toBe(join("sources", "template-source.pptx"));
		expect(readFileSync(staged.absolutePath, "utf-8")).toBe("fake-pptx");
	});

	it("rejects non-PowerPoint template files", () => {
		const root = mkdtempSync(join(tmpdir(), "ppt-template-fill-"));
		temporaryDirectories.push(root);
		const uploadPath = join(root, "uploaded.pdf");
		writeFileSync(uploadPath, "fake-pdf");

		expect(() => stageNativePptTemplate(join(root, "project"), [uploadPath])).toThrow(
			"PowerPoint OOXML",
		);
	});
});
