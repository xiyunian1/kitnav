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
	generatePptManifestImages,
	readPptImageManifest,
} from "./image-generation";
import {
	getPptImageCountLimit,
	getPptImageUnitCreditCost,
	isPptImageGenerationEnabled,
} from "./image-options";

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]).toString("base64")}`;

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
		expect(getPptImageCountLimit(30)).toBe(4);
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
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
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

	it("stores only a generic manifest error when the provider fails", async () => {
		const projectDir = createProject([
			{
				filename: "cover.png",
				prompt: "cover",
				aspect_ratio: "16:9",
				status: "Pending",
			},
		]);
		const provider: ImageProvider = {
			name: "mock",
			generate: vi.fn(async () => {
				throw new Error("sensitive upstream response");
			}),
		};

		await expect(
			generatePptManifestImages({
				projectDir,
				provider,
				model: "chosen-image-model",
				maxImages: 4,
			}),
		).rejects.toThrow("成功 0/1 张");
		const manifestText = readFileSync(
			join(projectDir, "images", "image_prompts.json"),
			"utf-8",
		);
		expect(manifestText).toContain("图片生成失败");
		expect(manifestText).not.toContain("sensitive upstream response");
	});
});
