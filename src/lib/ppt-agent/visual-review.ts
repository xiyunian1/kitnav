import {
	copyFileSync,
	existsSync,
	lstatSync,
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

export function buildPptVisualReviewPrompt(
	slides: PptVisualReviewSlide[],
	batchIndex: number,
	totalBatches: number,
) {
	const pairs = slides.flatMap((slide) => [
		`- PNG: .preview/${slide.pngFile}`,
		`  SVG: svg_output/${slide.svgFile}`,
	]);
	return [
		`执行服务器托管视觉复核第 ${batchIndex + 1}/${totalBatches} 批。只有用户主动开启时才会进入此阶段。`,
		"这是独立于 Strategist 和 Executor 的视觉复核会话；不得依赖先前会话记忆。",
		"先读取 .ppt-master-skill/references/visual-review.md、design_spec.md 和 spec_lock.md。不要启动 visual_review.py 或 live-preview server，PNG 已由服务器渲染。",
		"必须对下面每个 PNG 分别调用一次 read 工具，真实查看图片后再判断；只读 SVG 文本不算完成视觉复核。",
		...pairs,
		"先横向比较本批页面，再逐页检查：重复构图、视觉焦点不足、信息密度失衡、正文过小、低对比度、图片与内容无关，以及文字或图形重叠、裁切和对齐漂移。",
		"只允许局部、原子、可逆的坐标、尺寸、间距、对齐、换行或字号修正；必须保留原文案、事实、数据、图片、配色和页面职责。",
		"不得改变列数、图表类型或页面分区，不得增加或删除内容区块。当无意义卡片阵列或重复主构图必须依靠布局重构才能解决时，标记 needs_human 并写明建议，不得直接重构 SVG。",
		"同一批内超过两页使用相同主构图家族时应记录为重复构图问题。修正后仍须保持演示距离可读，并为每页保留单一第一视觉焦点。",
		"除下列 SVG 与本批报告外，不允许写入或修改任何文件。",
		"不得改主题、配色、文案、数据、图片或其他批次页面；不得修改 design_spec.md、spec_lock.md、images/、animations.json 或图片清单。",
		`将简短结果写入 .review/batch-${String(batchIndex + 1).padStart(2, "0")}.md，逐页标记 ok、fixed 或 needs_human。`,
		"不要导出 PPTX，不要运行 finalize_svg.py。完成本批后立即停止。",
	].join("\n");
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
		const sourceStats = lstatSync(slide.svgPath);
		if (!sourceStats.isFile() || sourceStats.nlink !== 1) {
			throw new Error(`视觉复核源文件不是独占普通文件：${slide.svgFile}`);
		}
		const backupPath = join(
			backupDir,
			`${parse(slide.svgFile).name}.before-visual-review.svg`,
		);
		rmSync(backupPath, { recursive: true, force: true });
		copyFileSync(slide.svgPath, backupPath);
		return { svgPath: slide.svgPath, backupPath };
	});
}

export function restorePptVisualReviewSlides(
	backups: PptVisualReviewBackup[],
) {
	for (const backup of backups) {
		rmSync(backup.svgPath, { recursive: true, force: true });
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
