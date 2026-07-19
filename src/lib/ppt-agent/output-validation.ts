import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";

const DATA_DRIVEN_CHART_TEMPLATES = new Set([
	"area_chart",
	"box_plot_chart",
	"bubble_chart",
	"bullet_chart",
	"butterfly_chart",
	"column_chart",
	"donut_chart",
	"dumbbell_chart",
	"dual_axis_line_chart",
	"funnel_chart",
	"gantt_chart",
	"gauge_chart",
	"grouped_bar_chart",
	"heatmap_chart",
	"horizontal_bar_chart",
	"line_chart",
	"pareto_chart",
	"pie_chart",
	"progress_bar_chart",
	"radar_chart",
	"sankey_chart",
	"scatter_chart",
	"stacked_area_chart",
	"stacked_bar_chart",
	"treemap_chart",
	"waterfall_chart",
]);

export interface PptVisualizationReference {
	page: number;
	template: string;
	path: string;
	usage: string;
}

export function listPptSvgFiles(projectDir: string) {
	const svgDir = join(projectDir, "svg_output");
	if (!existsSync(svgDir)) return [];
	return readdirSync(svgDir)
		.filter((file) => file.toLowerCase().endsWith(".svg"))
		.sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

export function findPptSvgFileByPage(projectDir: string, page: number) {
	return listPptSvgFiles(projectDir).find(
		(file) => parseSlideNumber(file) === page,
	);
}

export function assertExactPptSvgCount(
	projectDir: string,
	expectedSlideCount: number,
) {
	const files = listPptSvgFiles(projectDir);
	if (files.length !== expectedSlideCount) {
		throw new Error(
			`PPT 页面数量不正确：实际 ${files.length} 页，目标 ${expectedSlideCount} 页。`,
		);
	}
	return files;
}

export function assertPptSpeakerNotesSource(
	projectDir: string,
	expectedSlideCount: number,
) {
	const svgFiles = assertExactPptSvgCount(projectDir, expectedSlideCount);
	const totalPath = join(projectDir, "notes", "total.md");
	if (!isNonEmptyFile(totalPath)) {
		throw new Error("PPT 缺少完整讲稿 notes/total.md。");
	}
	return { totalPath, svgFiles };
}

export function assertPptSplitSpeakerNotes(
	projectDir: string,
	expectedSlideCount: number,
) {
	const { svgFiles } = assertPptSpeakerNotesSource(
		projectDir,
		expectedSlideCount,
	);
	const missing = svgFiles
		.map((file) => join(projectDir, "notes", `${file.slice(0, -4)}.md`))
		.filter((path) => !isNonEmptyFile(path));
	if (missing.length > 0) {
		throw new Error(
			`PPT 讲稿拆分不完整：缺少 ${missing.map((path) => basename(path)).join("、")}。`,
		);
	}
	return svgFiles;
}

export function countPptxReadbackSlides(markdown: string) {
	return Array.from(markdown.matchAll(/^## Slide\s+(\d+)\s*$/gm)).length;
}

export function assertPptxReadback(
	readbackPath: string,
	expectedSlideCount: number,
) {
	if (!isNonEmptyFile(readbackPath)) {
		throw new Error("PPTX 回读验证没有产生有效内容。");
	}
	const slideCount = countPptxReadbackSlides(
		readFileSync(readbackPath, "utf-8"),
	);
	if (slideCount !== expectedSlideCount) {
		throw new Error(
			`PPTX 实际页数不正确：回读 ${slideCount} 页，目标 ${expectedSlideCount} 页。`,
		);
	}
	return slideCount;
}

export function listPptVisualizationReferences(
	projectDir: string,
): PptVisualizationReference[] {
	const designSpecPath = join(projectDir, "design_spec.md");
	if (!isNonEmptyFile(designSpecPath)) return [];
	const content = readFileSync(designSpecPath, "utf-8");
	const section = content.match(
		/(?:^|\n)##\s+VII\.\s+Visualization Reference List[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i,
	)?.[1];
	if (!section) return [];

	const references: PptVisualizationReference[] = [];
	for (const line of section.split(/\r?\n/)) {
		const cells = line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim().replace(/^`|`$/g, ""));
		const page = cells[0]?.match(/^P(\d{1,3})$/i)?.[1];
		if (!page || !cells[1]) continue;
		references.push({
			page: Number(page),
			template: cells[1],
			path: cells[2] || "",
			usage: cells.at(-1) || "",
		});
	}
	return references.sort((left, right) => left.page - right.page);
}

export function listPptDataChartReferences(projectDir: string) {
	return listPptVisualizationReferences(projectDir).filter((reference) =>
		DATA_DRIVEN_CHART_TEMPLATES.has(reference.template),
	);
}

export function writePptChartVerificationEvidence(
	projectDir: string,
	receiptOutput: string,
	calculatorResults?: {
		calculatorScript: string;
		executedAt: string;
		pages: Array<{
			id: string;
			page: number;
			template: string;
			verificationMode: string;
			commands: unknown[];
		}>;
	},
) {
	const references = listPptVisualizationReferences(projectDir);
	const required = references.filter((reference) =>
		DATA_DRIVEN_CHART_TEMPLATES.has(reference.template),
	);
	const svgFiles = listPptSvgFiles(projectDir);
	const receipts = parseChartVerificationReceipts(receiptOutput);
	const duplicatePage = receipts.find(
		(receipt, index) =>
			receipts.findIndex((candidate) => candidate.page === receipt.page) !== index,
	);
	if (duplicatePage) {
		throw new Error(`PPT 图表校准回执重复：P${padPage(duplicatePage.page)}。`);
	}
	for (const reference of required) {
		if (!receipts.some((receipt) => receipt.page === reference.page)) {
			throw new Error(
				`PPT 图表页 P${padPage(reference.page)} 缺少 verify-charts 校准回执。`,
			);
		}
	}

	const pages = receipts.map((receipt) => {
		const svgFile = svgFiles.find(
			(file) =>
				file === receipt.svgFile || parseSlideNumber(file) === receipt.page,
		);
		if (!svgFile) {
			throw new Error(`PPT 图表校准回执指向不存在的 P${padPage(receipt.page)}。`);
		}
		const svgPath = join(projectDir, "svg_output", svgFile);
		const svg = readFileSync(svgPath, "utf-8");
		if (!/<!--\s*chart-plot-area\s*:/i.test(svg)) {
			throw new Error(`PPT 图表页 P${padPage(receipt.page)} 缺少 chart-plot-area 标记。`);
		}
		const reference = references.find((item) => item.page === receipt.page);
		const calculator = calculatorResults?.pages.find(
			(item) => item.page === receipt.page,
		);
		if (!calculator || calculator.template !== reference?.template) {
			throw new Error(
				`PPT 图表页 P${padPage(receipt.page)} 缺少宿主执行的官方计算记录。`,
			);
		}
		if (
			receipt.verificationMode !== calculator.verificationMode ||
			receipt.requestId !== calculator.id
		) {
			throw new Error(
				`PPT 图表页 P${padPage(receipt.page)} 的回执与宿主计算请求不匹配。`,
			);
		}
		return {
			page: receipt.page,
			template: reference?.template || "no-template-match",
			svgPath: `svg_output/${svgFile}`,
			chartPlotArea: true,
			svgSha256: createHash("sha256").update(svg).digest("hex"),
			nativeObjectMetadata: /data-pptx-native=["']chart["']/i.test(svg),
			receipt: receipt.line,
			calculator: {
				requestId: calculator.id,
				verificationMode: calculator.verificationMode,
				commandCount: calculator.commands.length,
				script: calculatorResults?.calculatorScript,
				executedAt: calculatorResults?.executedAt,
			},
			comparison: {
				scale: receipt.scale,
				result: receipt.result,
			},
		};
	});

	const evidencePath = join(projectDir, "validation", "chart-verification.json");
	if (references.length === 0 && pages.length === 0) {
		rmSync(evidencePath, { force: true });
		return 0;
	}
	mkdirSync(join(projectDir, "validation"), { recursive: true });
	const temporaryPath = `${evidencePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		temporaryPath,
		`${JSON.stringify(
			{
				schema: "ppt_hosted_chart_verification.v1",
				verifiedAt: new Date().toISOString(),
				pages,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);
	renameSync(temporaryPath, evidencePath);
	return pages.length;
}

export function assertPptChartVerification(projectDir: string) {
	const required = listPptDataChartReferences(projectDir);

	const evidencePath = join(projectDir, "validation", "chart-verification.json");
	if (!isNonEmptyFile(evidencePath)) {
		if (required.length === 0) return 0;
		throw new Error("PPT 图表页缺少服务器验证记录。");
	}
	let evidence: unknown;
	try {
		evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
	} catch {
		throw new Error("PPT 图表页服务器验证记录不是有效 JSON。");
	}
	if (
		!evidence ||
		typeof evidence !== "object" ||
		(evidence as { schema?: unknown }).schema !==
			"ppt_hosted_chart_verification.v1" ||
		!Array.isArray((evidence as { pages?: unknown }).pages)
	) {
		throw new Error("PPT 图表页服务器验证记录格式不正确。");
	}
	const pages = (evidence as {
		pages: Array<Record<string, unknown>>;
	}).pages;
	const svgFiles = listPptSvgFiles(projectDir);
	for (const { page, template } of required) {
		const svgFile = svgFiles.find((file) => parseSlideNumber(file) === page);
		if (!svgFile) throw new Error(`PPT 图表页 P${padPage(page)} 缺少 SVG 文件。`);
			const svgPath = join(projectDir, "svg_output", svgFile);
			const svg = readFileSync(svgPath, "utf-8");
			if (!/<!--\s*chart-plot-area\s*:/i.test(svg)) {
				throw new Error(`PPT 图表页 P${padPage(page)} 缺少 chart-plot-area 标记。`);
			}
		const record = pages.find((item) => Number(item.page) === page);
		const calculator =
			record?.calculator && typeof record.calculator === "object"
				? (record.calculator as Record<string, unknown>)
				: null;
		const comparison =
			record?.comparison && typeof record.comparison === "object"
				? (record.comparison as Record<string, unknown>)
				: null;
		if (
			!record ||
			record.template !== template ||
			record.svgPath !== `svg_output/${svgFile}` ||
				record.chartPlotArea !== true ||
				record.svgSha256 !== createHash("sha256").update(svg).digest("hex") ||
				typeof record.receipt !== "string" ||
				!record.receipt.startsWith("verify-charts:") ||
				!calculator ||
				calculator.script !==
					"scripts/svg_position_calculator.py" ||
				typeof calculator.requestId !== "string" ||
				typeof calculator.verificationMode !== "string" ||
				typeof calculator.commandCount !== "number" ||
				!comparison ||
				typeof comparison.scale !== "string" ||
				!comparison.scale.trim() ||
				(comparison.result !== "match" && comparison.result !== "verified")
			) {
			throw new Error(`PPT 图表页 P${padPage(page)} 的服务器验证记录不匹配。`);
		}
	}
	return pages.length;
}

function parseChartVerificationReceipts(output: string) {
	return Array.from(
		output.matchAll(/verify-charts:\s*([^|\r\n]+?)\s*\|\s*([^\r\n]+)/gi),
	).map((match) => {
		const svgFile = basename(match[1].trim());
		const page = parseSlideNumber(svgFile);
		if (!page) {
			throw new Error(`PPT 图表校准回执页码无法识别：${svgFile}。`);
		}
		const fields = new Map<string, string>();
		for (const segment of match[2].split("|")) {
			const field = segment.trim().match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
			if (!field) {
				throw new Error(`PPT 图表页 P${padPage(page)} 的校准回执字段格式不正确。`);
			}
			const key = field[1].toLowerCase();
			if (fields.has(key)) {
				throw new Error(`PPT 图表页 P${padPage(page)} 的校准回执字段重复：${key}。`);
			}
			fields.set(key, field[2].trim());
		}
		const verificationMode = fields.get("mode") || "";
		const requestId = fields.get("request") || "";
		const scale = fields.get("scale") || "";
		const result = fields.get("result") || "";
		if (
			!verificationMode ||
			!requestId ||
			!scale ||
			(result !== "match" && result !== "verified")
		) {
			throw new Error(
				`PPT 图表页 P${padPage(page)} 的校准回执必须包含 mode、request、scale 和有效 result。`,
			);
		}
		return {
			page,
			svgFile,
			verificationMode,
			requestId,
			scale,
			result: result as "match" | "verified",
			line: `verify-charts: ${match[1].trim()} | ${match[2].trim()}`,
		};
	});
}

function parseSlideNumber(file: string) {
	const leading = file.match(/^(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	const named = file.match(/(?:^|[_-])slide[_-]?(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	return Number(leading || named || 0);
}

function padPage(page: number) {
	return String(page).padStart(2, "0");
}

function isNonEmptyFile(path: string) {
	return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
}
