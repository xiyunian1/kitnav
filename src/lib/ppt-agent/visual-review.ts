import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
} from "node:fs";
import { basename, extname, join, parse } from "node:path";
import sharp from "sharp";

const REVIEW_BATCH_SIZE = 5;

export interface PptVisualReviewSlide {
	svgFile: string;
	pngFile: string;
	svgPath: string;
	pngPath: string;
}

export interface PptVisualReviewBackup {
	svgPath: string;
	backupPath: string;
}

export async function renderPptSlidesForVisualReview(input: {
	projectDir: string;
	aspectRatio: "16:9" | "4:3";
	svgFiles?: string[];
}) {
	const svgDir = join(input.projectDir, "svg_output");
	if (!existsSync(svgDir)) {
		throw new Error("视觉复核前缺少 svg_output 目录。");
	}

	const previewDir = join(input.projectDir, ".preview");
	mkdirSync(previewDir, { recursive: true });
	if (!input.svgFiles) {
		for (const file of readdirSync(previewDir)) {
			if (extname(file).toLowerCase() === ".png") {
				rmSync(join(previewDir, file), { force: true });
			}
		}
	}

	const svgFiles = resolveSvgFiles(svgDir, input.svgFiles);
	if (svgFiles.length < 1) {
		throw new Error("视觉复核前没有可渲染的 SVG 页面。");
	}
	const dimensions =
		input.aspectRatio === "4:3"
			? { width: 1200, height: 900 }
			: { width: 1280, height: 720 };

	const rendered: PptVisualReviewSlide[] = [];
	for (const svgFile of svgFiles) {
		const svgPath = join(svgDir, svgFile);
		const pngFile = `${parse(svgFile).name}.png`;
		const pngPath = join(previewDir, pngFile);
		await sharp(svgPath, { density: 144, limitInputPixels: 100_000_000 })
			.flatten({ background: "#ffffff" })
			.resize(dimensions.width, dimensions.height, { fit: "fill" })
			.png()
			.toFile(pngPath);

		const stats = await sharp(pngPath).stats();
		if (stats.channels.every((channel) => channel.stdev < 0.5)) {
			throw new Error(`视觉复核渲染为空白页：${svgFile}`);
		}
		rendered.push({ svgFile, pngFile, svgPath, pngPath });
	}
	return rendered;
}

export function batchPptVisualReviewSlides(
	slides: PptVisualReviewSlide[],
	batchSize = REVIEW_BATCH_SIZE,
) {
	const size = Math.max(1, Math.min(10, Math.floor(batchSize)));
	const batches: PptVisualReviewSlide[][] = [];
	for (let index = 0; index < slides.length; index += size) {
		batches.push(slides.slice(index, index + size));
	}
	return batches;
}

export function backupPptVisualReviewSlides(
	projectDir: string,
	slides: PptVisualReviewSlide[],
) {
	const backupDir = join(projectDir, ".review", "backup");
	mkdirSync(backupDir, { recursive: true });
	return slides.map((slide) => {
		const backupPath = join(
			backupDir,
			`${parse(slide.svgFile).name}.before-visual-review.svg`,
		);
		copyFileSync(slide.svgPath, backupPath);
		return { svgPath: slide.svgPath, backupPath };
	});
}

export function restorePptVisualReviewSlides(
	backups: PptVisualReviewBackup[],
) {
	for (const backup of backups) {
		copyFileSync(backup.backupPath, backup.svgPath);
	}
}

export function assertPptVisualReviewImagesRead(
	output: string,
	slides: PptVisualReviewSlide[],
) {
	const readCalls = new Map<string, string>();
	const successful = new Set<string>();
	for (const line of output.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line) as {
				type?: string;
				toolName?: string;
				toolCallId?: string;
				args?: { path?: unknown };
				isError?: boolean;
			};
			if (
				event.type === "tool_execution_start" &&
				event.toolName === "read" &&
				event.toolCallId &&
				typeof event.args?.path === "string"
			) {
				readCalls.set(event.toolCallId, event.args.path);
			}
			if (
				event.type === "tool_execution_end" &&
				event.toolCallId &&
				!event.isError
			) {
				const path = readCalls.get(event.toolCallId);
				if (path) successful.add(path.replaceAll("\\", "/"));
			}
		} catch {
			// Ignore non-JSON process lines.
		}
	}
	const missing = slides.filter(
		(slide) =>
			![...successful].some((path) => path.endsWith(`/${slide.pngFile}`)),
	);
	if (missing.length > 0) {
		throw new Error(
			`模型未实际读取 ${missing.map((slide) => slide.pngFile).join("、")}`,
		);
	}
}

function resolveSvgFiles(svgDir: string, requested?: string[]) {
	const available = readdirSync(svgDir)
		.filter((file) => extname(file).toLowerCase() === ".svg")
		.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
	if (!requested) return available;

	const availableSet = new Set(available);
	return requested.map((file) => {
		const safeName = basename(file);
		if (safeName !== file || !availableSet.has(safeName)) {
			throw new Error(`视觉复核页面不存在：${file}`);
		}
		return safeName;
	});
}
