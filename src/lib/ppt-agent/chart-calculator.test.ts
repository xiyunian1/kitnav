import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execute: vi.fn(),
}));

vi.mock("./python-tools", () => ({
	executePptPython: mocks.execute,
	getPptScriptPath: (name: string, skillDir: string) =>
		join(skillDir, "scripts", name),
}));

import {
	assertPptChartCalculatorResults,
	executePptChartCalculatorRequests,
	readAndValidatePptChartCalculatorRequests,
} from "./chart-calculator";

const roots: string[] = [];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.execute.mockResolvedValue({ stdout: "calculated", stderr: "", exitCode: 0 });
});

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hosted PPT chart calculator", () => {
	it("validates requests, executes the official calculator, and binds results to the request", async () => {
		const root = createProject("column_chart");
		writeRequests(root, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-column",
					page: 1,
					template: "column_chart",
					verificationMode: "direct-calc",
					commands: [
						{
							calculator: "bar",
							args: [
								"calc",
								"bar",
								"--data",
								"A:10,B:20",
								"--area",
								"100,100,700,500",
								"--value-range",
								"0,100",
							],
						},
					],
					rationale: "Use the declared plot area and y-axis ticks.",
				},
			],
		});

		await executePptChartCalculatorRequests(root, "/skill");
		expect(mocks.execute).toHaveBeenCalledWith(
			"/skill/scripts/svg_position_calculator.py",
			expect.arrayContaining(["calc", "bar", "--data", "A:10,B:20"]),
			60_000,
			"/skill",
		);
		expect(assertPptChartCalculatorResults(root).pages[0]).toMatchObject({
			page: 1,
			verificationMode: "direct-calc",
		});

		const requests = readAndValidatePptChartCalculatorRequests(root);
		requests.requests[0].rationale = "changed after execution";
		writeRequests(root, requests);
		expect(() => assertPptChartCalculatorResults(root)).toThrow("不匹配");
	});

	it("rejects unapproved flags and requires calculator commands for direct charts", () => {
		const root = createProject("line_chart");
		writeRequests(root, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-line",
					page: 1,
					template: "line_chart",
					verificationMode: "direct-calc",
					commands: [
						{
							calculator: "line",
							args: ["calc", "line", "--data", "1:2", "--output", "/tmp/x"],
						},
					],
					rationale: "line coordinates",
				},
			],
		});
		expect(() => readAndValidatePptChartCalculatorRequests(root)).toThrow(
			"不允许的参数",
		);

		const noCommand = createProject("line_chart");
		writeRequests(noCommand, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-line",
					page: 1,
					template: "line_chart",
					verificationMode: "direct-calc",
					commands: [],
					rationale: "missing command",
				},
			],
		});
		expect(() => readAndValidatePptChartCalculatorRequests(noCommand)).toThrow(
			"没有实际计算器命令",
		);
	});

	it("records formula/manual pages without pretending to run a calculator", async () => {
		const root = createProject("heatmap_chart");
		writeRequests(root, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-heatmap",
					page: 1,
					template: "heatmap_chart",
					verificationMode: "manual-verify",
					commands: [],
					rationale: "Inspect every cell against the source matrix.",
				},
			],
		});

		await executePptChartCalculatorRequests(root, "/skill");
		expect(mocks.execute).not.toHaveBeenCalled();
		expect(assertPptChartCalculatorResults(root).pages[0].commands).toEqual([]);
	});

	it("allows honest manual fallback only for decomposable or partial charts", () => {
		const stacked = createProject("stacked_bar_chart");
		writeRequests(stacked, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-stacked",
					page: 1,
					template: "stacked_bar_chart",
					verificationMode: "manual-verify",
					commands: [],
					rationale:
						"Negative segments do not reduce to the official stacked recipe; inspect every segment against the axis.",
				},
			],
		});
		expect(
			readAndValidatePptChartCalculatorRequests(stacked).requests[0]
				.verificationMode,
		).toBe("manual-verify");

		const direct = createProject("column_chart");
		writeRequests(direct, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-column",
					page: 1,
					template: "column_chart",
					verificationMode: "manual-verify",
					commands: [],
					rationale: "Skipped direct calculation.",
				},
			],
		});
		expect(() => readAndValidatePptChartCalculatorRequests(direct)).toThrow(
			"验证模式不正确",
		);
	});

	it("rejects calculator results whose command identity or arguments changed", async () => {
		const root = createProject("column_chart");
		writeRequests(root, {
			schema: "ppt_hosted_chart_calculator_requests.v1",
			requests: [
				{
					id: "p01-column",
					page: 1,
					template: "column_chart",
					verificationMode: "direct-calc",
					commands: [
						{
							calculator: "bar",
							args: ["calc", "bar", "--data", "A:10,B:20"],
						},
					],
					rationale: "Verify both bars.",
				},
			],
		});

		await executePptChartCalculatorRequests(root, "/skill");
		const resultPath = join(root, "validation", "chart-calculator-results.json");
		const changedArgs = JSON.parse(readFileSync(resultPath, "utf-8")) as {
			pages: Array<{ commands: Array<{ calculator: string; args: string[] }> }>;
		};
		changedArgs.pages[0].commands[0].args[3] = "A:10,B:99";
		writeFileSync(resultPath, `${JSON.stringify(changedArgs, null, 2)}\n`, "utf-8");
		expect(() => assertPptChartCalculatorResults(root)).toThrow(
			"第 1 条计算结果与请求不匹配",
		);

		await executePptChartCalculatorRequests(root, "/skill");
		const changedCalculator = JSON.parse(
			readFileSync(resultPath, "utf-8"),
		) as {
			pages: Array<{ commands: Array<{ calculator: string; args: string[] }> }>;
		};
		changedCalculator.pages[0].commands[0].calculator = "line";
		writeFileSync(
			resultPath,
			`${JSON.stringify(changedCalculator, null, 2)}\n`,
			"utf-8",
		);
		expect(() => assertPptChartCalculatorResults(root)).toThrow(
			"第 1 条计算结果与请求不匹配",
		);
	});
});

function createProject(template: string) {
	const root = mkdtempSync(join(tmpdir(), "ppt-chart-calculator-"));
	roots.push(root);
	mkdirSync(join(root, "analysis"), { recursive: true });
	mkdirSync(join(root, "validation"), { recursive: true });
	writeFileSync(
		join(root, "design_spec.md"),
		[
			"## VII. Visualization Reference List (if needed)",
			"| Page | Template | Path | Summary | Usage |",
			"| ---- | -------- | ---- | ------- | ----- |",
			`| P01 | ${template} | templates/charts/${template}.svg | chart | compare |`,
			"## VIII. Image Resource List",
		].join("\n"),
	);
	return root;
}

function writeRequests(root: string, value: unknown) {
	writeFileSync(
		join(root, "analysis", "chart-calculator-requests.json"),
		`${JSON.stringify(value, null, 2)}\n`,
		"utf-8",
	);
}
