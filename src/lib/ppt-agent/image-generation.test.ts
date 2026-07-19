import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImageProvider } from "@/lib/providers/types";
import {
	ensurePptImageAnalysisCsv,
	generatePptManifestImages,
	isPptImageManifestTerminal,
	readPptImageManifest,
} from "./image-generation";
import {
	getPptImageCountLimit,
	getPptImageUnitCreditCost,
	isPptImageGenerationEnabled,
} from "./image-options";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

describe("PPT image generation", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	function createProject(items: unknown[]) {
		const projectDir = mkdtempSync(join(tmpdir(), "ppt-images-"));
		temporaryDirectories.push(projectDir);
		mkdirSync(join(projectDir, "images"), { recursive: true });
		writeFileSync(
			join(projectDir, "images", "image_prompts.json"),
			JSON.stringify({ project: "test", items }),
			"utf-8",
		);
		return projectDir;
	}

	function writeSliceContracts(
		projectDir: string,
		parentFilename: string,
		sliceNames: string[],
	) {
		writeFileSync(
			join(projectDir, "design_spec.md"),
			[
				"## VIII. Image Resource List (if needed)",
				"",
				"| Filename | Dimensions | Ratio | Purpose | Type | Layout pattern | Acquire Via | Status | Reference | text_policy | page_role |",
				"| -------- | ---------- | ----- | ------- | ---- | -------------- | ----------- | ------ | --------- | ----------- | --------- |",
				`| ${parentFilename} | pending | 1:1 | Spot family | Illustration Sheet | #63 sticker | ai | Pending | compact spot set | none | local |`,
				...sliceNames.map(
					(name) =>
						`| ${name} | pending | 1:1 | Spot | Illustration | #63 sticker | slice | Pending | ${parentFilename} element | | |`,
				),
				"",
				"## IX. Content Outline",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(projectDir, "spec_lock.md"),
			[
				"## images",
				`- parent_sheet: images/${parentFilename}`,
				`- first_slice: images/${sliceNames[0]}`,
				"",
				"## page_rhythm",
				"- P01: anchor",
			].join("\n"),
			"utf-8",
		);
	}

	it("enables server image generation only for SVG tasks with a complete selection", () => {
		expect(
			isPptImageGenerationEnabled({
				workflow: "svg",
				imageModel: "image-model",
				imageModelSource: "platform",
				imageCountLimit: 4,
			}),
		).toBe(true);
		expect(
			isPptImageGenerationEnabled({
				workflow: "template-fill",
				imageModel: "image-model",
				imageModelSource: "platform",
				imageCountLimit: 4,
			}),
		).toBe(false);
		expect(isPptImageGenerationEnabled({ workflow: "svg" })).toBe(false);
		expect(getPptImageCountLimit(3)).toBe(2);
		expect(getPptImageCountLimit(10)).toBe(4);
		expect(getPptImageCountLimit(18)).toBe(6);
		expect(getPptImageCountLimit(30)).toBe(8);
		expect(
			getPptImageUnitCreditCost({
				source: "platform",
				creditCost: null,
				fallbackCost: 9.6,
			}),
		).toBe(10);
		expect(
			getPptImageUnitCreditCost({
				source: "user",
				creditCost: 99,
				fallbackCost: 10,
			}),
		).toBe(0);
	});

	it("generates every manifest item without persisting provider secrets", async () => {
		const projectDir = createProject([
			{
				filename: "cover.png",
				prompt: "A clean editorial cover",
				aspect_ratio: "16:9",
				status: "Pending",
			},
			{
				filename: "detail.png",
				prompt: "A focused detail image",
				aspect_ratio: "4:3",
				status: "Pending",
			},
		]);
		const generate = vi.fn(async () => ({ urls: [PNG_DATA_URL] }));
		const provider = {
			name: "mock",
			secretApiKey: "must-not-be-written",
			generate,
		} as ImageProvider & { secretApiKey: string };

		const result = await generatePptManifestImages({
			projectDir,
			provider,
			model: "chosen-image-model",
			maxImages: 4,
		});

		expect(result.generatedCount).toBe(2);
		expect(result.failedCount).toBe(0);
		expect(result.plannedCount).toBe(2);
		expect(generate).toHaveBeenCalledTimes(2);
		const manifestText = readFileSync(result.manifestPath, "utf-8");
		expect(manifestText).not.toContain(provider.secretApiKey);
		const manifest = JSON.parse(manifestText) as {
			items: Array<{ status: string; model: string }>;
		};
		expect(manifest.items).toEqual([
			expect.objectContaining({ status: "Generated", model: "chosen-image-model" }),
			expect.objectContaining({ status: "Generated", model: "chosen-image-model" }),
		]);
		expect(readFileSync(join(projectDir, "images", "cover.png"))).toEqual(
			PNG,
		);
	});

	it("rejects traversal filenames and manifests above the task limit", () => {
		const traversalProject = createProject([
			{
				filename: "../secret.png",
				prompt: "unsafe",
				aspect_ratio: "16:9",
				status: "Pending",
			},
		]);
		expect(() => readPptImageManifest(traversalProject, 4)).toThrow(
			"文件名不安全",
		);

		const oversizedProject = createProject(
			Array.from({ length: 5 }, (_, index) => ({
				filename: `image_${index}.png`,
				prompt: `image ${index}`,
				aspect_ratio: "16:9",
				status: "Pending",
			})),
		);
		expect(() => readPptImageManifest(oversizedProject, 4)).toThrow(
			"超过本任务上限",
		);
	});

	it("retries a failed image once before succeeding", async () => {
		const projectDir = createProject([
			{
				filename: "cover.png",
				prompt: "cover",
				aspect_ratio: "16:9",
				status: "Pending",
			},
		]);
		const generate = vi
			.fn()
			.mockRejectedValueOnce(new Error("temporary upstream failure"))
			.mockResolvedValueOnce({ urls: [PNG_DATA_URL] });
		const provider = { name: "mock", generate } as ImageProvider;

		const result = await generatePptManifestImages({
			projectDir,
			provider,
			model: "chosen-image-model",
			maxImages: 4,
		});

		expect(generate).toHaveBeenCalledTimes(2);
		expect(result).toEqual(
			expect.objectContaining({ generatedCount: 1, failedCount: 0 }),
		);
		const manifest = JSON.parse(
			readFileSync(result.manifestPath, "utf-8"),
		) as { items: Array<{ status: string }> };
		expect(manifest.items[0].status).toBe("Generated");
	});

	it("marks exhausted items Needs-Manual and keeps successful images", async () => {
		const projectDir = createProject([
			{
				filename: "cover.png",
				prompt: "cover",
				aspect_ratio: "16:9",
				status: "Pending",
			},
			{
				filename: "detail.png",
				prompt: "detail",
				aspect_ratio: "4:3",
				status: "Pending",
			},
		]);
		let coverAttempts = 0;
		const provider: ImageProvider = {
			name: "mock",
			generate: vi.fn(async ({ prompt }) => {
				if (prompt === "cover") {
					coverAttempts += 1;
					throw new Error(`sensitive upstream response ${coverAttempts}`);
				}
				return { urls: [PNG_DATA_URL] };
			}),
		};

		const result = await generatePptManifestImages({
			projectDir,
			provider,
			model: "chosen-image-model",
			maxImages: 4,
		});
		expect(result).toEqual(
			expect.objectContaining({
				generatedCount: 1,
				failedCount: 1,
				plannedCount: 2,
			}),
		);
		expect(provider.generate).toHaveBeenCalledTimes(3);
		const manifestText = readFileSync(
			join(projectDir, "images", "image_prompts.json"),
			"utf-8",
		);
		expect(manifestText).toContain("Needs-Manual");
		expect(manifestText).toContain("已自动重试 1 次");
		expect(manifestText).not.toContain("sensitive upstream response");
		expect(readFileSync(join(projectDir, "images", "detail.png"))).toEqual(
			PNG,
		);
	});

	it("propagates cancellation instead of degrading it to a missing image", async () => {
		const projectDir = createProject([
			{
				filename: "cover.png",
				prompt: "cover",
				aspect_ratio: "16:9",
				status: "Pending",
			},
		]);
		const generate = vi.fn(async () => ({ urls: [PNG_DATA_URL] }));
		const controller = new AbortController();
		controller.abort(new Error("用户已停止生成"));

		await expect(
			generatePptManifestImages({
				projectDir,
				provider: { name: "mock", generate },
				model: "chosen-image-model",
				maxImages: 4,
				signal: controller.signal,
			}),
		).rejects.toThrow("用户已停止生成");
		expect(generate).not.toHaveBeenCalled();
	});

	it("generates one illustration sheet and derives every slice without extra image calls", async () => {
		const sliceNames = ["team.png", "growth.png"];
		const projectDir = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "A 1x2 coherent illustration sheet",
				aspect_ratio: "16:9",
				status: "Pending",
				slice_grid: "1x2",
				slice_names: sliceNames,
			},
		]);
		writeSliceContracts(projectDir, "spot_sheet.png", sliceNames);
		const generate = vi.fn(async () => ({ urls: [PNG_DATA_URL] }));
		const sliceImageSheet = vi.fn(async ({ outputDir, names }) => {
			for (const name of names) writeFileSync(join(outputDir, name), PNG);
		});

		const result = await generatePptManifestImages({
			projectDir,
			provider: { name: "mock", generate } as ImageProvider,
			model: "chosen-image-model",
			maxImages: 1,
			sliceImageSheet,
		});

		expect(generate).toHaveBeenCalledTimes(1);
		expect(sliceImageSheet).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			plannedCount: 1,
			generatedCount: 1,
			billableCount: 1,
			slicedCount: 2,
			sliceFailedCount: 0,
		});
		const manifest = JSON.parse(
			readFileSync(result.manifestPath, "utf-8"),
		) as {
			items: Array<{
				status: string;
				derived_items: Array<{ filename: string; status: string }>;
			}>;
		};
		expect(manifest.items[0].status).toBe("Generated");
		expect(manifest.items[0].derived_items).toEqual([
			expect.objectContaining({ filename: "team.png", status: "Generated" }),
			expect.objectContaining({ filename: "growth.png", status: "Generated" }),
		]);
		const designSpec = readFileSync(join(projectDir, "design_spec.md"), "utf-8");
		expect(designSpec).toContain(
			"| spot_sheet.png | 1x1 | 1:1 | Spot family | Illustration Sheet",
		);
		expect(designSpec).toContain(
			"| team.png | 1x1 | 1:1 | Spot | Illustration | #63 sticker | slice | Generated |",
		);
		const specLock = readFileSync(join(projectDir, "spec_lock.md"), "utf-8");
		expect(specLock).not.toContain("images/spot_sheet.png");
		expect(specLock).toContain("images/team.png | no-crop");
		expect(specLock).toContain("images/growth.png | no-crop");
	});

	it("marks derived resources unavailable when their parent sheet fails", async () => {
		const sliceNames = ["team.png", "growth.png"];
		const projectDir = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "A 1x2 coherent illustration sheet",
				aspect_ratio: "16:9",
				status: "Pending",
				slice_grid: "1x2",
				slice_names: sliceNames,
			},
		]);
		writeSliceContracts(projectDir, "spot_sheet.png", sliceNames);
		const generate = vi.fn(async () => {
			throw new Error("upstream unavailable");
		});
		const sliceImageSheet = vi.fn(async () => undefined);

		const result = await generatePptManifestImages({
			projectDir,
			provider: { name: "mock", generate } as ImageProvider,
			model: "chosen-image-model",
			maxImages: 1,
			sliceImageSheet,
		});

		expect(generate).toHaveBeenCalledTimes(2);
		expect(sliceImageSheet).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			generatedCount: 0,
			billableCount: 0,
			failedCount: 1,
			slicedCount: 0,
			sliceFailedCount: 2,
		});
		const manifestText = readFileSync(result.manifestPath, "utf-8");
		expect(manifestText).toContain('"status": "Needs-Manual"');
		expect(manifestText).not.toContain("upstream unavailable");
		const designSpec = readFileSync(join(projectDir, "design_spec.md"), "utf-8");
		expect(designSpec.match(/\| Needs-Manual \|/g)).toHaveLength(3);
	});

	it("rejects unsafe slice names and grid/name count mismatches before generation", () => {
		const traversalProject = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "sheet",
				aspect_ratio: "1:1",
				status: "Pending",
				slice_grid: "1x1",
				slice_names: ["../secret.png"],
			},
		]);
		expect(() => readPptImageManifest(traversalProject, 1)).toThrow(
			"切片文件名不安全",
		);
		const delimiterProject = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "sheet",
				aspect_ratio: "1:1",
				status: "Pending",
				slice_grid: "1x1",
				slice_names: ["one,two.png"],
			},
		]);
		expect(() => readPptImageManifest(delimiterProject, 1)).toThrow(
			"切片文件名不安全",
		);

		const mismatchProject = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "sheet",
				aspect_ratio: "1:1",
				status: "Pending",
				slice_grid: "2x2",
				slice_names: ["one.png", "two.png"],
			},
		]);
		expect(() => readPptImageManifest(mismatchProject, 1)).toThrow(
			"数量与 2x2 网格不一致",
		);
	});

	it("reuses validated parent and slice files on resume without new calls", async () => {
		const sliceNames = ["team.png", "growth.png"];
		const projectDir = createProject([
			{
				filename: "spot_sheet.png",
				prompt: "A 1x2 coherent illustration sheet",
				aspect_ratio: "16:9",
				status: "Generated",
				model: "chosen-image-model",
				generated_at: "2026-07-18T00:00:00.000Z",
				slice_grid: "1x2",
				slice_names: sliceNames,
			},
		]);
		writeSliceContracts(projectDir, "spot_sheet.png", sliceNames);
		for (const name of ["spot_sheet.png", ...sliceNames]) {
			writeFileSync(join(projectDir, "images", name), PNG);
		}
		const generate = vi.fn(async () => ({ urls: [PNG_DATA_URL] }));
		const sliceImageSheet = vi.fn(async () => undefined);

		const result = await generatePptManifestImages({
			projectDir,
			provider: { name: "mock", generate } as ImageProvider,
			model: "chosen-image-model",
			maxImages: 1,
			sliceImageSheet,
		});

		expect(generate).not.toHaveBeenCalled();
		expect(sliceImageSheet).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			generatedCount: 1,
			billableCount: 1,
			newlyGeneratedCount: 0,
			reusedCount: 1,
			slicedCount: 2,
		});
	});

	it("creates an empty analysis inventory when no image was generated", () => {
		const projectDir = createProject([]);
		mkdirSync(join(projectDir, "analysis"), { recursive: true });
		writeFileSync(
			join(projectDir, "analysis", "image_analysis.csv"),
			"stale,image,row\n",
			"utf-8",
		);
		const csvPath = ensurePptImageAnalysisCsv(projectDir, true);
		const csv = readFileSync(csvPath, "utf-8");
		expect(csv).toContain("Filename,Width,Height");
		expect(csv.trim().split("\n")).toHaveLength(1);
	});

	it("recognizes only fully settled manifests as terminal", () => {
		const terminalProject = createProject([
			{
				filename: "ready.png",
				prompt: "ready",
				aspect_ratio: "1:1",
				status: "Generated",
			},
			{
				filename: "fallback.png",
				prompt: "fallback",
				aspect_ratio: "1:1",
				status: "Needs-Manual",
			},
		]);
		const pendingProject = createProject([
			{
				filename: "pending.png",
				prompt: "pending",
				aspect_ratio: "1:1",
				status: "Pending",
			},
		]);

		expect(isPptImageManifestTerminal(terminalProject, 2)).toBe(true);
		expect(isPptImageManifestTerminal(pendingProject, 1)).toBe(false);
	});
});
