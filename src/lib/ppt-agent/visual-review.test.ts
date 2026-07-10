import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
	assertPptVisualReviewImagesRead,
	batchPptVisualReviewSlides,
	renderPptSlidesForVisualReview,
} from "./visual-review";

describe("PPT hosted visual review renderer", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	function createProject(svg: string, filename = "01_slide.svg") {
		const projectDir = mkdtempSync(join(tmpdir(), "ppt-visual-review-"));
		directories.push(projectDir);
		mkdirSync(join(projectDir, "svg_output"), { recursive: true });
		writeFileSync(join(projectDir, "svg_output", filename), svg, "utf-8");
		return projectDir;
	}

	it("renders review PNGs at the selected canvas ratio", async () => {
		const projectDir = createProject(`
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
				<rect width="1280" height="720" fill="#fff"/>
				<text x="80" y="160" font-size="64" fill="#111">视觉复核</text>
			</svg>
		`);

		const slides = await renderPptSlidesForVisualReview({
			projectDir,
			aspectRatio: "16:9",
		});
		expect(slides).toHaveLength(1);
		expect(await sharp(slides[0].pngPath).metadata()).toMatchObject({
			width: 1280,
			height: 720,
			format: "png",
		});
		expect(batchPptVisualReviewSlides([...slides, ...slides], 1)).toHaveLength(2);
	});

	it("rejects a visually blank render", async () => {
		const projectDir = createProject(`
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
				<rect width="1280" height="720" fill="#fff"/>
			</svg>
		`);

		await expect(
			renderPptSlidesForVisualReview({ projectDir, aspectRatio: "16:9" }),
		).rejects.toThrow("空白页");
	});

	it("requires a successful read tool event for every rendered PNG", () => {
		const slides = [
			{
				svgFile: "01_slide.svg",
				pngFile: "01_slide.png",
				svgPath: "/tmp/01_slide.svg",
				pngPath: "/tmp/01_slide.png",
			},
		];
		expect(() =>
			assertPptVisualReviewImagesRead(
				JSON.stringify({ type: "user", text: ".preview/01_slide.png" }),
				slides,
			),
		).toThrow("未实际读取");

		const output = [
			JSON.stringify({
				type: "tool_execution_start",
				toolName: "read",
				toolCallId: "read-1",
				args: { path: ".preview/01_slide.png" },
			}),
			JSON.stringify({
				type: "tool_execution_end",
				toolName: "read",
				toolCallId: "read-1",
				isError: false,
			}),
		].join("\n");
		expect(() => assertPptVisualReviewImagesRead(output, slides)).not.toThrow();
	});
});
