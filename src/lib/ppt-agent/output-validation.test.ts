import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertExactPptSvgCount,
	assertPptChartVerification,
	assertPptSpeakerNotesSource,
	assertPptSplitSpeakerNotes,
	assertPptxReadback,
	countPptxReadbackSlides,
	listPptDataChartReferences,
	listPptVisualizationReferences,
	writePptChartVerificationEvidence,
} from "./output-validation";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
	});

function createProject(slideCount = 2) {
	const root = mkdtempSync(join(tmpdir(), "ppt-output-validation-"));
	roots.push(root);
	mkdirSync(join(root, "svg_output"));
	mkdirSync(join(root, "notes"));
	for (let index = 1; index <= slideCount; index += 1) {
		const stem = `${String(index).padStart(2, "0")}_slide`;
		writeFileSync(join(root, "svg_output", `${stem}.svg`), "<svg/>");
	}
	return root;
}

describe("PPT output validation", () => {
	it("requires the exact requested SVG count", () => {
		const root = createProject(2);
		expect(assertExactPptSvgCount(root, 2)).toHaveLength(2);
		expect(() => assertExactPptSvgCount(root, 3)).toThrow(
			"实际 2 页，目标 3 页",
		);
	});

	it("requires a non-empty total speaker-notes source", () => {
		const root = createProject(1);
		expect(() => assertPptSpeakerNotesSource(root, 1)).toThrow(
			"notes/total.md",
		);
		writeFileSync(join(root, "notes", "total.md"), "# 01_slide\n\n讲稿");
		expect(assertPptSpeakerNotesSource(root, 1).svgFiles).toEqual([
			"01_slide.svg",
		]);
	});

	it("requires one non-empty split note for every SVG", () => {
		const root = createProject(2);
		writeFileSync(join(root, "notes", "total.md"), "# 01_slide\n\n第一页");
		writeFileSync(join(root, "notes", "01_slide.md"), "第一页");
		expect(() => assertPptSplitSpeakerNotes(root, 2)).toThrow("02_slide.md");
		writeFileSync(join(root, "notes", "02_slide.md"), "第二页");
		expect(assertPptSplitSpeakerNotes(root, 2)).toHaveLength(2);
	});

	it("counts and validates slides from the official PPTX readback", () => {
		const markdown = "# Deck\n\n## Slide 1\n\nA\n\n## Slide 2\n\nB\n";
		expect(countPptxReadbackSlides(markdown)).toBe(2);
		const root = createProject(0);
		const path = join(root, "readback.md");
		writeFileSync(path, markdown);
		expect(assertPptxReadback(path, 2)).toBe(2);
		expect(() => assertPptxReadback(path, 3)).toThrow(
			"回读 2 页，目标 3 页",
		);
	});

	it("parses official visualization references and filters structural diagrams", () => {
		const root = createProject(2);
		writeFileSync(
			join(root, "design_spec.md"),
			[
				"## VII. Visualization Reference List (if needed)",
				"",
				"| Page | Template | Path | Summary | Usage |",
				"| ---- | -------- | ---- | ------- | ----- |",
				"| P01 | column_chart | `templates/charts/column_chart.svg` | quote | revenue |",
				"| P02 | timeline | `templates/charts/timeline.svg` | quote | roadmap |",
				"",
				"## VIII. Image Resource List",
			].join("\n"),
		);
		expect(listPptVisualizationReferences(root)).toHaveLength(2);
		expect(listPptDataChartReferences(root)).toMatchObject([
			{ page: 1, template: "column_chart" },
		]);
	});

	it("records hosted verify-charts receipts and validates chart markers", () => {
		const root = createProject(1);
		writeFileSync(
			join(root, "design_spec.md"),
			[
				"## VII. Visualization Reference List (if needed)",
				"| Page | Template | Path | Summary | Usage |",
				"| ---- | -------- | ---- | ------- | ----- |",
				"| P01 | column_chart | `templates/charts/column_chart.svg` | quote | revenue |",
				"## VIII. Image Resource List",
			].join("\n"),
		);
		writeFileSync(
			join(root, "svg_output", "01_slide.svg"),
			"<svg><!-- chart-plot-area: 10,10,100,100 --></svg>",
		);
			expect(
					writePptChartVerificationEvidence(
						root,
						"verify-charts: 01_slide.svg | mode=direct-calc | request=p01-column | scale=axis-0-100 | result=match",
					{
						calculatorScript: "scripts/svg_position_calculator.py",
						executedAt: new Date().toISOString(),
						pages: [
							{
								id: "p01-column",
								page: 1,
								template: "column_chart",
								verificationMode: "direct-calc",
								commands: [{}],
							},
						],
					},
				),
		).toBe(1);
		expect(assertPptChartVerification(root)).toBe(1);
		writeFileSync(join(root, "svg_output", "01_slide.svg"), "<svg/>");
		expect(() => assertPptChartVerification(root)).toThrow("chart-plot-area");
	});

	it("rejects chart receipts that do not bind to the hosted request", () => {
		const root = createProject(1);
		writeFileSync(
			join(root, "design_spec.md"),
			[
				"## VII. Visualization Reference List (if needed)",
				"| Page | Template | Path | Summary | Usage |",
				"| P01 | column_chart | path | chart | compare |",
				"## VIII. Image Resource List",
			].join("\n"),
		);
		writeFileSync(
			join(root, "svg_output", "01_slide.svg"),
			"<svg><!-- chart-plot-area: 10,10,100,100 --></svg>",
		);
		const calculatorResults = {
			calculatorScript: "scripts/svg_position_calculator.py",
			executedAt: new Date().toISOString(),
			pages: [
				{
					id: "p01-column",
					page: 1,
					template: "column_chart",
					verificationMode: "direct-calc",
					commands: [{}],
				},
			],
		};

		expect(() =>
			writePptChartVerificationEvidence(
				root,
				"verify-charts: 01_slide.svg | mode=manual-verify | request=wrong | scale=manual | result=verified",
				calculatorResults,
			),
		).toThrow("回执与宿主计算请求不匹配");
		expect(() =>
			writePptChartVerificationEvidence(
				root,
				"verify-charts: 01_slide.svg | mode=direct-calc | request=p01-column | result=match",
				calculatorResults,
			),
		).toThrow("必须包含 mode、request、scale");
	});

	it("rejects missing or duplicate chart receipts", () => {
		const root = createProject(1);
		writeFileSync(
			join(root, "design_spec.md"),
			[
				"## VII. Visualization Reference List (if needed)",
				"| Page | Template | Path | Summary | Usage |",
				"| P01 | line_chart | path | quote | trend |",
				"## VIII. Image Resource List",
			].join("\n"),
		);
		writeFileSync(
			join(root, "svg_output", "01_slide.svg"),
			"<svg><!-- chart-plot-area: 0,0,10,10 --></svg>",
		);
		expect(() => writePptChartVerificationEvidence(root, "done")).toThrow(
			"缺少 verify-charts",
		);
		expect(() =>
				writePptChartVerificationEvidence(
					root,
					[
						"verify-charts: 01_slide.svg | mode=direct-calc | request=p01-line | scale=axis-0-100 | result=match",
						"verify-charts: 01_slide.svg | mode=direct-calc | request=p01-line | scale=axis-0-100 | result=match",
					].join("\n"),
			),
		).toThrow("回执重复");
	});
});
