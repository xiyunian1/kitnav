import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertNativeTemplateFillArtifacts } from "./template-fill-validation";

const templateFillDecisionSchema = z.object({
	schema: z.literal("ppt_hosted_template_fill_decision.v1"),
	slides: z
		.array(
			z.object({
				planIndex: z.number().int().positive(),
				sourceSlide: z.number().int().positive(),
			}),
		)
		.min(1)
		.max(30),
	confirmedAt: z.string().datetime(),
});

export const templateFillSubmissionSchema = z.object({
	kind: z.literal("template-fill"),
	slides: z
		.array(
			z.object({
				planIndex: z.number().int().positive(),
				sourceSlide: z.number().int().positive(),
			}),
		)
		.min(1)
		.max(30),
});

export type PptTemplateFillDecision = z.infer<typeof templateFillDecisionSchema>;

export interface PptTemplateFillConfirmation {
	summary: string;
	availableSlides: Array<{
		sourceSlide: number;
		pageType: string;
		label: string;
		textSummary: string;
	}>;
	plannedSlides: Array<{
		planIndex: number;
		sourceSlide: number;
		purpose: string;
		layoutPattern: string;
		whyFit: string;
		risk: string;
	}>;
}

export function getPptTemplateFillDecisionPath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_template_fill_decision.json");
}

export function hasPptTemplateFillDecision(projectDir: string) {
	return existsSync(getPptTemplateFillDecisionPath(projectDir));
}

export function readPptTemplateFillDecision(projectDir: string) {
	try {
		return templateFillDecisionSchema.parse(
			JSON.parse(readFileSync(getPptTemplateFillDecisionPath(projectDir), "utf-8")),
		);
	} catch (error) {
		throw new Error(
			`无法读取有效的模板填充确认结果：${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function readPptTemplateFillConfirmation(
	projectDir: string,
	expectedSlideCount: number,
): PptTemplateFillConfirmation {
	const { library, plan, report } = assertNativeTemplateFillArtifacts(
		projectDir,
		expectedSlideCount,
		{ requiredStatus: "draft" },
	);
	return {
		summary:
			report.summary.warn > 0
				? `已完成模板容量检查，存在 ${report.summary.warn} 条非阻断提示。`
				: "已完成模板页面匹配与容量检查。",
		availableSlides: library.slides.map((slide) => {
			const titleSlot = slide.slots.find((slot) =>
				/title|heading/i.test(slot.role || ""),
			);
			const fallbackText = slide.slots.find((slot) => slot.text.trim())?.text || "";
			const summary = slide.text_summary?.trim() || fallbackText.trim();
			return {
				sourceSlide: slide.slide_index,
				pageType: slide.page_type?.trim() || "content",
				label:
					titleSlot?.text.trim() ||
					summary.slice(0, 48) ||
					`模板第 ${slide.slide_index} 页`,
				textSummary: summary.slice(0, 240),
			};
		}),
		plannedSlides: plan.slides.map((slide, index) => ({
			planIndex: index + 1,
			sourceSlide: slide.source_slide,
			purpose: slide.purpose,
			layoutPattern: slide.layout_rationale.layout_pattern,
			whyFit: slide.layout_rationale.why_fit,
			risk: slide.layout_rationale.risk,
		})),
	};
}

export function writePptTemplateFillDecision(
	projectDir: string,
	expectedSlideCount: number,
	input: z.infer<typeof templateFillSubmissionSchema>,
) {
	const { library, plan } = assertNativeTemplateFillArtifacts(
		projectDir,
		expectedSlideCount,
		{ requiredStatus: "draft" },
	);
	if (input.slides.length !== expectedSlideCount) {
		throw new Error(
			`模板填充确认页数不正确：当前 ${input.slides.length} 页，要求 ${expectedSlideCount} 页。`,
		);
	}
	const planIndexes = new Set(input.slides.map((slide) => slide.planIndex));
	if (
		planIndexes.size !== plan.slides.length ||
		[...planIndexes].some((index) => index < 1 || index > plan.slides.length)
	) {
		throw new Error("模板填充确认必须完整保留每个规划页面且不能重复。");
	}
	const sourceSlides = new Set(library.slides.map((slide) => slide.slide_index));
	if (input.slides.some((slide) => !sourceSlides.has(slide.sourceSlide))) {
		throw new Error("模板填充确认引用了不存在的模板页面。");
	}

	const value = templateFillDecisionSchema.parse({
		schema: "ppt_hosted_template_fill_decision.v1",
		slides: input.slides,
		confirmedAt: new Date().toISOString(),
	});
	const path = getPptTemplateFillDecisionPath(projectDir);
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, path);
	return value;
}

export function assertPptTemplateFillDecisionApplied(
	projectDir: string,
	expectedSlideCount: number,
) {
	const decision = readPptTemplateFillDecision(projectDir);
	const { plan } = assertNativeTemplateFillArtifacts(projectDir, expectedSlideCount);
	if (decision.slides.length !== plan.slides.length) {
		throw new Error("最终模板填充方案页数与用户确认结果不一致。");
	}
	for (const [index, selected] of decision.slides.entries()) {
		const planned = plan.slides[index] as typeof plan.slides[number] & {
			hosted_plan_index?: unknown;
		};
		if (
			planned.source_slide !== selected.sourceSlide ||
			Number(planned.hosted_plan_index) !== selected.planIndex
		) {
			throw new Error(`最终模板填充方案第 ${index + 1} 页没有应用用户确认的页面映射。`);
		}
	}
	return decision;
}
