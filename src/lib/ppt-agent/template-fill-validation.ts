import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import {
	listValidatedZipEntries,
	listValidatedZipEntryMetadata,
} from "./upload-validation";

const nonEmptyText = z.string().trim().min(1);

const librarySlotSchema = z
	.object({
		slot_id: nonEmptyText,
		role: z.string().optional(),
		text: z.string(),
	})
	.passthrough();

const librarySlideSchema = z
	.object({
		slide_index: z.number().int().positive(),
		page_type: z.string().optional(),
		text_summary: z.string().optional(),
		slots: z.array(librarySlotSchema),
		tables: z.array(z.unknown()).optional(),
		charts: z.array(z.unknown()).optional(),
	})
	.passthrough();

const slideLibrarySchema = z
	.object({
		schema: z.literal("template_fill_pptx_library.v1"),
		source_pptx: nonEmptyText,
		slide_count: z.number().int().positive(),
		slides: z.array(librarySlideSchema).min(1),
	})
	.passthrough();

const replacementSchema = z
	.object({
		slot_id: nonEmptyText,
		text: z.string(),
	})
	.passthrough();

const planSlideSchema = z
	.object({
		source_slide: z.number().int().positive(),
		purpose: nonEmptyText,
		layout_rationale: z.object({
			layout_pattern: nonEmptyText,
			why_fit: nonEmptyText,
			risk: nonEmptyText,
		}),
		replacements: z.array(replacementSchema),
		table_edits: z.array(z.unknown()).optional(),
		chart_edits: z.array(z.unknown()).optional(),
	})
	.passthrough();

const fillPlanSchema = z
	.object({
		schema: z.literal("template_fill_pptx_plan.v1"),
		status: z.enum(["draft", "confirmed"]),
		source_pptx: nonEmptyText,
		accepted_warnings: z.array(z.unknown()).optional(),
		slides: z.array(planSlideSchema).min(1),
	})
	.passthrough();

const checkResultSchema = z
	.object({
		status: z.enum(["OK", "WARN", "ERROR"]),
		code: nonEmptyText,
		plan_slide: z.number().int().positive().optional(),
		source_slide: z.number().int().positive().optional(),
	})
	.passthrough();

const checkReportSchema = z
	.object({
		schema: z.literal("template_fill_pptx_check.v1"),
		summary: z.object({
			ok: z.number().int().nonnegative(),
			warn: z.number().int().nonnegative(),
			error: z.number().int().nonnegative(),
		}),
		results: z.array(checkResultSchema),
	})
	.passthrough();

const BLOCKING_WARNING_CODES = new Set(["non_text_content_unedited"]);
const PLACEHOLDER_PATTERNS = [
	/\blorem\s+ipsum\b/i,
	/\b(?:placeholder|sample\s+text|your\s+title|click\s+to\s+(?:add|edit)|type\s+here)\b/i,
	/(?:单击|点击)(?:此处)?(?:添加|编辑)/,
	/(?:在此输入|请输入|添加标题|添加文本|样本文本|示例文本|标题文本|正文文本)/,
	/(?:优品\s*ppt|第一\s*ppt|稻壳(?:儿)?|51ppt|1ppt)/i,
	/(?:^|\W)x{2,}(?:公司|集团|标题|姓名)?(?:\W|$)/i,
	/(?:^|\W)20xx(?:\W|$)/i,
];

export function assertNativeTemplateFillArtifacts(
	projectDir: string,
	expectedSlideCount: number,
	options: { requiredStatus?: "draft" | "confirmed" } = {},
) {
	const analysisDir = join(projectDir, "analysis");
	const library = parseArtifact(
		join(analysisDir, "slide_library.json"),
		slideLibrarySchema,
		"模板页库",
	);
	const plan = parseArtifact(
		join(analysisDir, "fill_plan.json"),
		fillPlanSchema,
		"模板填充方案",
	);
	const report = parseArtifact(
		join(analysisDir, "check_report.json"),
		checkReportSchema,
		"模板容量检查报告",
	);
	const requiredStatus = options.requiredStatus || "confirmed";
	if (plan.status !== requiredStatus) {
		throw new Error(
			`模板填充方案状态不正确：当前为 ${plan.status}，要求为 ${requiredStatus}。`,
		);
	}

	if (library.slide_count !== library.slides.length) {
		throw new Error(
			`模板页库页数不一致：slide_count=${library.slide_count}，slides=${library.slides.length}。`,
		);
	}
	const libraryBySlide = new Map(
		library.slides.map((slide) => [slide.slide_index, slide]),
	);
	if (libraryBySlide.size !== library.slides.length) {
		throw new Error("模板页库包含重复的 slide_index。");
	}
	if (basename(plan.source_pptx) !== basename(library.source_pptx)) {
		throw new Error("模板填充方案引用的源 PPTX 与模板页库不一致。");
	}
	if (plan.slides.length !== expectedSlideCount) {
		throw new Error(
			`原生模板填充页数不正确：方案为 ${plan.slides.length} 页，目标为 ${expectedSlideCount} 页。`,
		);
	}

	const planFingerprints = new Set<string>();
	for (const [index, planSlide] of plan.slides.entries()) {
		const source = libraryBySlide.get(planSlide.source_slide);
		if (!source) {
			throw new Error(
				`模板填充方案第 ${index + 1} 页引用了不存在的源页 ${planSlide.source_slide}。`,
			);
		}
		const replacements = new Map<string, string>();
		for (const replacement of planSlide.replacements) {
			const key = replacement.slot_id.toLowerCase();
			if (replacements.has(key)) {
				throw new Error(
					`模板填充方案第 ${index + 1} 页重复替换槽位 ${replacement.slot_id}。`,
				);
			}
			replacements.set(key, replacement.text);
			if (containsTemplatePlaceholder(replacement.text)) {
				throw new Error(
					`模板填充方案第 ${index + 1} 页仍包含占位或模板站示例文字：${replacement.slot_id}。`,
				);
			}
		}

		const sourceSlots = new Map(
			source.slots.map((slot) => [slot.slot_id.toLowerCase(), slot]),
		);
		for (const slotId of replacements.keys()) {
			if (!sourceSlots.has(slotId)) {
				throw new Error(
					`模板填充方案第 ${index + 1} 页引用了不存在的槽位 ${slotId}。`,
				);
			}
		}
		for (const slot of source.slots.filter((item) => item.text.trim())) {
			const replacement = replacements.get(slot.slot_id.toLowerCase());
			if (replacement === undefined) {
				throw new Error(
					`模板填充方案第 ${index + 1} 页未处理原模板文字槽位 ${slot.slot_id}。`,
				);
			}
			if (looksLikeUnchangedSample(slot.text, replacement, slot.role || "")) {
				throw new Error(
					`模板填充方案第 ${index + 1} 页仍保留原模板示例文字：${slot.slot_id}。`,
				);
			}
		}
		if (
			planSlide.replacements.length === 0 &&
			!(planSlide.table_edits?.length || planSlide.chart_edits?.length)
		) {
			throw new Error(`模板填充方案第 ${index + 1} 页没有任何实际填充内容。`);
		}

		const fingerprint = JSON.stringify({
			source: planSlide.source_slide,
			purpose: planSlide.purpose,
			replacements: [...replacements].sort(([left], [right]) =>
				left.localeCompare(right),
			),
			tableEdits: planSlide.table_edits || [],
			chartEdits: planSlide.chart_edits || [],
		});
		if (planFingerprints.has(fingerprint)) {
			throw new Error(
				`模板填充方案第 ${index + 1} 页与其他页面完全重复，未形成独立内容。`,
			);
		}
		planFingerprints.add(fingerprint);
	}

	const statusCounts = { OK: 0, WARN: 0, ERROR: 0 };
	for (const result of report.results) {
		statusCounts[result.status] += 1;
		if (result.plan_slide && result.plan_slide > plan.slides.length) {
			throw new Error("模板容量检查报告引用了不存在的方案页。");
		}
	}
	if (
		report.summary.ok !== statusCounts.OK ||
		report.summary.warn !== statusCounts.WARN ||
		report.summary.error !== statusCounts.ERROR
	) {
		throw new Error("模板容量检查报告的 summary 与 results 不一致。");
	}
	if (report.summary.error > 0) {
		throw new Error(`原生模板填充容量检查仍有 ${report.summary.error} 个错误。`);
	}
	const blockingWarning = report.results.find(
		(result) =>
			result.status === "WARN" && BLOCKING_WARNING_CODES.has(result.code),
	);
	if (blockingWarning) {
		throw new Error(
			`原生模板填充仍会残留未编辑的非文字内容：${blockingWarning.code}。`,
		);
	}

	return { library, plan, report, slideCount: plan.slides.length };
}

export function assertNativeTemplatePptxPackage(
	templatePath: string,
	outputPath: string,
	expectedSlideCount: number,
) {
	const templateBuffer = readFileSync(templatePath);
	const outputBuffer = readFileSync(outputPath);
	const templateEntries = listValidatedZipEntries(templateBuffer);
	const outputEntries = listValidatedZipEntries(outputBuffer);
	const templateMetadata = listValidatedZipEntryMetadata(templateBuffer);
	const outputMetadata = listValidatedZipEntryMetadata(outputBuffer);
	const slides = [...outputEntries].filter((entry) =>
		/^ppt\/slides\/slide\d+\.xml$/i.test(entry),
	);
	if (slides.length !== expectedSlideCount) {
		throw new Error(
			`原生模板 PPTX 包内页数不正确：${slides.length}/${expectedSlideCount}。`,
		);
	}
	for (const slide of slides) {
		const filename = basename(slide);
		if (!outputEntries.has(`ppt/slides/_rels/${filename}.rels`)) {
			throw new Error(`原生模板 PPTX 缺少页面关系文件：${filename}.rels。`);
		}
	}
	for (const required of [
		"[Content_Types].xml",
		"ppt/presentation.xml",
		"ppt/_rels/presentation.xml.rels",
	]) {
		if (!outputEntries.has(required)) {
			throw new Error(`原生模板 PPTX 缺少必要包文件：${required}。`);
		}
	}

	const stylePatterns = [
		/^ppt\/slideMasters\/slideMaster\d+\.xml$/i,
		/^ppt\/slideLayouts\/slideLayout\d+\.xml$/i,
		/^ppt\/theme\/theme\d+\.xml$/i,
	];
	for (const pattern of stylePatterns) {
		const outputStyleEntries = [...outputEntries].filter((entry) =>
			pattern.test(entry),
		);
		if (outputStyleEntries.length === 0) {
			throw new Error("原生模板 PPTX 未保留母版、布局或主题资源。");
		}
		if (outputStyleEntries.some((entry) => !templateEntries.has(entry))) {
			throw new Error("原生模板 PPTX 包含不属于上传模板的样式资源。");
		}
		const changed = outputStyleEntries.filter((entry) => {
			const source = templateMetadata.get(entry);
			const output = outputMetadata.get(entry);
			return (
				!source ||
				!output ||
				source.crc32 !== output.crc32 ||
				source.uncompressedBytes !== output.uncompressedBytes
			);
		});
		if (changed.length > 0) {
			throw new Error(
				`原生模板 PPTX 改写了模板样式资源：${changed.join("、")}。`,
			);
		}
	}
	return slides.length;
}

function parseArtifact<T>(
	path: string,
	schema: z.ZodType<T>,
	label: string,
): T {
	try {
		return schema.parse(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		throw new Error(
			`${label}格式不正确：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function containsTemplatePlaceholder(value: string) {
	return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function looksLikeUnchangedSample(oldText: string, newText: string, role: string) {
	const oldValue = oldText.replace(/\s+/g, "").trim();
	const newValue = newText.replace(/\s+/g, "").trim();
	if (!oldValue || oldValue !== newValue) return false;
	if (containsTemplatePlaceholder(oldText)) return true;
	const length = Array.from(oldValue).length;
	return (
		(role === "title_candidate" && length >= 6) ||
		(role === "body_candidate" && length >= 12)
	);
}
