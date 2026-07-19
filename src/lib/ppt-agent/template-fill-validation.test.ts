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
	assertNativeTemplateFillArtifacts,
	assertNativeTemplatePptxPackage,
} from "./template-fill-validation";
import {
	assertPptTemplateFillDecisionApplied,
	readPptTemplateFillConfirmation,
	writePptTemplateFillDecision,
} from "./template-fill-confirmation";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-template-validation-"));
	roots.push(root);
	mkdirSync(join(root, "analysis"), { recursive: true });
	writeJson(join(root, "analysis", "slide_library.json"), {
		schema: "template_fill_pptx_library.v1",
		source_pptx: join(root, "sources", "template-source.pptx"),
		slide_count: 1,
		slides: [
			{
				slide_index: 1,
				slots: [
					{
						slot_id: "s01_sh1",
						role: "title_candidate",
						text: "示例项目标题文字",
					},
					{
						slot_id: "s01_sh2",
						role: "body_candidate",
						text: "这是一段用于展示模板排版容量的示例正文内容。",
					},
				],
				tables: [],
				charts: [],
			},
		],
	});
	writeJson(join(root, "analysis", "fill_plan.json"), {
		schema: "template_fill_pptx_plan.v1",
		status: "confirmed",
		source_pptx: join(root, "sources", "template-source.pptx"),
		accepted_warnings: [],
		slides: [
			{
				source_slide: 1,
				purpose: "项目开场",
				layout_rationale: {
					layout_pattern: "大标题与摘要",
					why_fit: "标题区域适合承载核心主题。",
					risk: "摘要需要保持精简。",
				},
				replacements: [
					{ slot_id: "s01_sh1", text: "区域增长策略" },
					{ slot_id: "s01_sh2", text: "聚焦客户、产品与渠道协同。" },
				],
				table_edits: [],
				chart_edits: [],
			},
		],
	});
	writeJson(join(root, "analysis", "check_report.json"), {
		schema: "template_fill_pptx_check.v1",
		summary: { ok: 2, warn: 0, error: 0 },
		results: [
			{
				status: "OK",
				code: "text_fit",
				plan_slide: 1,
				source_slide: 1,
			},
			{
				status: "OK",
				code: "text_fit",
				plan_slide: 1,
				source_slide: 1,
			},
		],
	});
	return root;
}

describe("native template-fill validation", () => {
	it("accepts a complete confirmed plan mapped to the analyzed template", () => {
		const root = createProject();
		expect(assertNativeTemplateFillArtifacts(root, 1)).toMatchObject({
			slideCount: 1,
		});
	});

	it("exposes a draft mapping for confirmation and verifies the applied decision", () => {
		const root = createProject();
		const planPath = join(root, "analysis", "fill_plan.json");
		const draft = readJson(planPath);
		draft.status = "draft";
		writeJson(planPath, draft);

		const confirmation = readPptTemplateFillConfirmation(root, 1);
		expect(confirmation.plannedSlides).toEqual([
			expect.objectContaining({ planIndex: 1, sourceSlide: 1 }),
		]);
		writePptTemplateFillDecision(root, 1, {
			kind: "template-fill",
			slides: [{ planIndex: 1, sourceSlide: 1 }],
		});

		const confirmed = readJson(planPath);
		confirmed.status = "confirmed";
		(confirmed.slides as Array<Record<string, unknown>>)[0].hosted_plan_index = 1;
		writeJson(planPath, confirmed);
		expect(assertPptTemplateFillDecisionApplied(root, 1).slides).toEqual([
			{ planIndex: 1, sourceSlide: 1 },
		]);
	});

	it("rejects missing source slides and incomplete template text replacement", () => {
		const invalidSource = createProject();
		const planPath = join(invalidSource, "analysis", "fill_plan.json");
		const plan = readJson(planPath);
		(plan.slides as Array<Record<string, unknown>>)[0].source_slide = 2;
		writeJson(planPath, plan);
		expect(() => assertNativeTemplateFillArtifacts(invalidSource, 1)).toThrow(
			"不存在的源页 2",
		);

		const incomplete = createProject();
		const incompletePlanPath = join(incomplete, "analysis", "fill_plan.json");
		const incompletePlan = readJson(incompletePlanPath);
		(
			(incompletePlan.slides as Array<Record<string, unknown>>)[0]
				.replacements as unknown[]
		).pop();
		writeJson(incompletePlanPath, incompletePlan);
		expect(() => assertNativeTemplateFillArtifacts(incomplete, 1)).toThrow(
			"未处理原模板文字槽位 s01_sh2",
		);
	});

	it("rejects unchanged sample copy, placeholders, and unresolved report errors", () => {
		const unchanged = createProject();
		const unchangedPlanPath = join(unchanged, "analysis", "fill_plan.json");
		const unchangedPlan = readJson(unchangedPlanPath);
		const unchangedReplacements = (
			(unchangedPlan.slides as Array<Record<string, unknown>>)[0]
				.replacements as Array<Record<string, unknown>>
		);
		unchangedReplacements[0].text = "示例项目标题文字";
		writeJson(unchangedPlanPath, unchangedPlan);
		expect(() => assertNativeTemplateFillArtifacts(unchanged, 1)).toThrow(
			"仍保留原模板示例文字",
		);

		const placeholder = createProject();
		const placeholderPlanPath = join(placeholder, "analysis", "fill_plan.json");
		const placeholderPlan = readJson(placeholderPlanPath);
		const placeholderReplacements = (
			(placeholderPlan.slides as Array<Record<string, unknown>>)[0]
				.replacements as Array<Record<string, unknown>>
		);
		placeholderReplacements[1].text = "单击此处添加文本";
		writeJson(placeholderPlanPath, placeholderPlan);
		expect(() => assertNativeTemplateFillArtifacts(placeholder, 1)).toThrow(
			"仍包含占位",
		);

		const reportError = createProject();
		writeJson(join(reportError, "analysis", "check_report.json"), {
			schema: "template_fill_pptx_check.v1",
			summary: { ok: 0, warn: 0, error: 1 },
			results: [
				{
					status: "ERROR",
					code: "replacement_target_not_found",
					plan_slide: 1,
					source_slide: 1,
				},
			],
		});
		expect(() => assertNativeTemplateFillArtifacts(reportError, 1)).toThrow(
			"仍有 1 个错误",
		);
	});

	it("checks slide parts and preserves template master, layout, and theme entries", () => {
		const root = createProject();
		const templatePath = join(root, "template.pptx");
		const outputPath = join(root, "output.pptx");
		const styleEntries = [
			"ppt/slideMasters/slideMaster1.xml",
			"ppt/slideLayouts/slideLayout1.xml",
			"ppt/theme/theme1.xml",
		];
		writeFileSync(
			templatePath,
			makeStoredZip([
				"[Content_Types].xml",
				"ppt/presentation.xml",
				"ppt/_rels/presentation.xml.rels",
				"ppt/slides/slide1.xml",
				"ppt/slides/_rels/slide1.xml.rels",
				...styleEntries,
				"ppt/slideMasters/slideMaster2.xml",
				"ppt/slideLayouts/slideLayout2.xml",
				"ppt/theme/theme2.xml",
			]),
		);
		writeFileSync(
			outputPath,
			makeStoredZip([
				"[Content_Types].xml",
				"ppt/presentation.xml",
				"ppt/_rels/presentation.xml.rels",
				"ppt/slides/slide1.xml",
				"ppt/slides/_rels/slide1.xml.rels",
				"ppt/slides/slide2.xml",
				"ppt/slides/_rels/slide2.xml.rels",
				...styleEntries,
				"ppt/slideMasters/slideMaster2.xml",
				"ppt/slideLayouts/slideLayout2.xml",
				"ppt/theme/theme2.xml",
			]),
		);

		expect(assertNativeTemplatePptxPackage(templatePath, outputPath, 2)).toBe(2);
		expect(() =>
			assertNativeTemplatePptxPackage(templatePath, outputPath, 1),
		).toThrow("包内页数不正确");

		const changedStyleOutput = join(root, "output-changed-style.pptx");
		writeFileSync(
			changedStyleOutput,
			makeStoredZip([
				"[Content_Types].xml",
				"ppt/presentation.xml",
				"ppt/_rels/presentation.xml.rels",
				"ppt/slides/slide1.xml",
				"ppt/slides/_rels/slide1.xml.rels",
				...styleEntries,
				"ppt/slideMasters/slideMaster2.xml",
				"ppt/slideLayouts/slideLayout2.xml",
				"ppt/theme/theme2.xml",
			], { "ppt/theme/theme1.xml": 1 }),
		);
		expect(() =>
			assertNativeTemplatePptxPackage(templatePath, changedStyleOutput, 1),
		).toThrow("改写了模板样式资源");
	});
});

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson(path: string) {
	return JSON.parse(readFileSync(path, "utf-8")) as Record<
		string,
		unknown
	>;
}

function makeStoredZip(names: string[], crcByName: Record<string, number> = {}) {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let localOffset = 0;
	for (const name of names) {
		const encodedName = Buffer.from(name, "utf8");
		const local = Buffer.alloc(30 + encodedName.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt32LE(crcByName[name] || 0, 14);
		local.writeUInt16LE(encodedName.length, 26);
		encodedName.copy(local, 30);
		localParts.push(local);

		const central = Buffer.alloc(46 + encodedName.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt32LE(crcByName[name] || 0, 16);
		central.writeUInt16LE(encodedName.length, 28);
		central.writeUInt32LE(localOffset, 42);
		encodedName.copy(central, 46);
		centralParts.push(central);
		localOffset += local.length;
	}
	const centralDirectory = Buffer.concat(centralParts);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(names.length, 8);
	eocd.writeUInt16LE(names.length, 10);
	eocd.writeUInt32LE(centralDirectory.length, 12);
	eocd.writeUInt32LE(localOffset, 16);
	return Buffer.concat([...localParts, centralDirectory, eocd]);
}
