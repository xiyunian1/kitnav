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
import { preparePptRunSource, type GenerationParams } from "./generator";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("preparePptRunSource", () => {
	it("resumes from preserved artifacts without reopening the original upload", async () => {
		const root = createConfirmedProject();
		const sourcePath = join(root, "sources", "source.md");
		const original = "# 已转换资料\n\n恢复时必须直接复用。";
		writeFileSync(sourcePath, original);

		const result = await preparePptRunSource(
			params({
				planningConfirmed: true,
				sourceType: "document",
				sourceFileUrl: "/path/that/no/longer/exists.docx",
			}),
			root,
		);

		expect(result).toEqual({ sourceMd: original, resumed: true });
		expect(readFileSync(sourcePath, "utf-8")).toBe(original);
	});

	it("fails closed when any confirmation artifact is missing", async () => {
		const root = createConfirmedProject();
		rmSync(join(root, "spec_lock.md"));

		await expect(
			preparePptRunSource(params({ planningConfirmed: true }), root),
		).rejects.toThrow("设计确认资料不完整");
	});

	it("preserves an intermediate legacy confirmation task without reconverting sources", async () => {
		const root = createConfirmedProject();
		const original = "# preserved legacy source";
		writeFileSync(join(root, "sources", "source.md"), original);
		rmSync(join(root, "analysis", "hosted_confirmation_result.json"));

		await expect(
			preparePptRunSource(
				params({
					planningConfirmationStage: "design-system",
					sourceType: "document",
					sourceFileUrl: "/missing/source.pdf",
				}),
				root,
			),
		).resolves.toEqual({ sourceMd: original, resumed: true });
	});

	it("resumes a verified automatic planning result after a worker restart", async () => {
		const root = createConfirmedProject();
		const original = "# automatic planning source";
		writeFileSync(join(root, "sources", "source.md"), original);

		await expect(
			preparePptRunSource(
				params({
					sourceType: "document",
					sourceFileUrl: "/missing/source.pdf",
				}),
				root,
			),
		).resolves.toEqual({
			sourceMd: original,
			resumed: true,
			resumePlanning: true,
		});
	});

	it("resumes a confirmed native template plan from project artifacts", async () => {
		const root = mkdtempSync(join(tmpdir(), "ppt-template-source-"));
		roots.push(root);
		mkdirSync(join(root, "sources"), { recursive: true });
		mkdirSync(join(root, "analysis"), { recursive: true });
		writeFileSync(join(root, "sources", "source.md"), "# template material");
		for (const name of [
			"slide_library.json",
			"fill_plan.json",
			"hosted_template_fill_decision.json",
		]) {
			writeFileSync(join(root, "analysis", name), "{}");
		}

		await expect(
			preparePptRunSource(
				params({
					planningConfirmed: true,
					templateFileUrls: ["/missing/template.pptx"],
				}),
				root,
				"template-fill",
			),
		).resolves.toMatchObject({ resumed: true, sourceMd: "# template material" });
	});
});

function createConfirmedProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-confirmed-source-"));
	roots.push(root);
	mkdirSync(join(root, "sources"), { recursive: true });
	mkdirSync(join(root, "analysis"), { recursive: true });
	writeFileSync(join(root, "sources", "source.md"), "# source");
	writeFileSync(join(root, "design_spec.md"), "# design");
	writeFileSync(join(root, "spec_lock.md"), "# lock");
	writeFileSync(join(root, "analysis", "hosted_confirmation.json"), "{}");
	writeFileSync(join(root, "analysis", "hosted_confirmation_result.json"), "{}");
	return root;
}

function params(overrides: Partial<GenerationParams> = {}): GenerationParams {
	return {
		projectId: "project-1",
		userId: "user-1",
		workerLease: "lease-1",
		sourceType: "markdown",
		sourceMarkdown: "# source",
		...overrides,
	};
}
