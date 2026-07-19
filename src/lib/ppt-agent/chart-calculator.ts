import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
	listPptDataChartReferences,
	type PptVisualizationReference,
} from "./output-validation";
import { executePptPython, getPptScriptPath } from "./python-tools";

const verificationModeSchema = z.enum([
	"direct-calc",
	"decomposable-calc",
	"partial-calc",
	"formula-verify",
	"manual-verify",
]);

const commandSchema = z.object({
	calculator: z.enum(["bar", "line", "pie", "radar"]),
	args: z.array(z.string().min(1).max(4_000)).min(3).max(32),
});

const requestsSchema = z.object({
	schema: z.literal("ppt_hosted_chart_calculator_requests.v1"),
	requests: z
		.array(
			z.object({
				id: z
					.string()
					.min(1)
					.max(80)
					.regex(/^[A-Za-z0-9_-]+$/),
				page: z.number().int().positive().max(100),
				template: z.string().min(1).max(120),
				verificationMode: verificationModeSchema,
				commands: z.array(commandSchema).max(24),
				rationale: z.string().min(1).max(1_000),
			}),
		)
		.max(30),
});

const resultCommandSchema = z.object({
	calculator: z.enum(["bar", "line", "pie", "radar"]),
	args: z.array(z.string()),
	stdout: z.string(),
	stderr: z.string(),
	exitCode: z.literal(0),
});

const resultsSchema = z.object({
	schema: z.literal("ppt_hosted_chart_calculator_results.v1"),
	requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
	calculatorScript: z.literal("scripts/svg_position_calculator.py"),
	executedAt: z.string().datetime(),
	pages: z.array(
		z.object({
			id: z.string(),
			page: z.number().int().positive(),
			template: z.string(),
			verificationMode: verificationModeSchema,
			commands: z.array(resultCommandSchema),
		}),
	),
});

export type PptChartCalculatorResults = z.infer<typeof resultsSchema>;

type VerificationMode = z.infer<typeof verificationModeSchema>;

const DIRECT_MODES = new Set<VerificationMode>(["direct-calc"]);
const DECOMPOSABLE_MODES = new Set<VerificationMode>([
	"decomposable-calc",
	"manual-verify",
]);
const PARTIAL_MODES = new Set<VerificationMode>([
	"partial-calc",
	"manual-verify",
]);
const FORMULA_MODES = new Set<VerificationMode>(["formula-verify"]);
const MANUAL_MODES = new Set<VerificationMode>(["manual-verify"]);

const TEMPLATE_ALLOWED_VERIFICATION_MODES: Record<
	string,
	ReadonlySet<VerificationMode>
> = {
	area_chart: DIRECT_MODES,
	box_plot_chart: DECOMPOSABLE_MODES,
	bubble_chart: PARTIAL_MODES,
	bullet_chart: DECOMPOSABLE_MODES,
	butterfly_chart: DECOMPOSABLE_MODES,
	column_chart: DIRECT_MODES,
	donut_chart: DIRECT_MODES,
	dumbbell_chart: DECOMPOSABLE_MODES,
	dual_axis_line_chart: DECOMPOSABLE_MODES,
	funnel_chart: FORMULA_MODES,
	gantt_chart: DECOMPOSABLE_MODES,
	gauge_chart: FORMULA_MODES,
	grouped_bar_chart: DECOMPOSABLE_MODES,
	heatmap_chart: MANUAL_MODES,
	horizontal_bar_chart: DIRECT_MODES,
	line_chart: DIRECT_MODES,
	pareto_chart: DECOMPOSABLE_MODES,
	pie_chart: DIRECT_MODES,
	progress_bar_chart: FORMULA_MODES,
	radar_chart: DIRECT_MODES,
	sankey_chart: MANUAL_MODES,
	scatter_chart: DIRECT_MODES,
	stacked_area_chart: DECOMPOSABLE_MODES,
	stacked_bar_chart: DECOMPOSABLE_MODES,
	treemap_chart: MANUAL_MODES,
	waterfall_chart: DECOMPOSABLE_MODES,
};

const CALCULATOR_REQUIRED_MODES = new Set([
	"direct-calc",
	"decomposable-calc",
	"partial-calc",
]);

const TEMPLATE_CALCULATORS: Record<string, Set<string>> = {
	area_chart: new Set(["line"]),
	box_plot_chart: new Set(["bar"]),
	bubble_chart: new Set(["line"]),
	bullet_chart: new Set(["bar"]),
	butterfly_chart: new Set(["bar"]),
	column_chart: new Set(["bar"]),
	donut_chart: new Set(["pie"]),
	dumbbell_chart: new Set(["line"]),
	dual_axis_line_chart: new Set(["line"]),
	gantt_chart: new Set(["line"]),
	grouped_bar_chart: new Set(["bar"]),
	horizontal_bar_chart: new Set(["bar"]),
	line_chart: new Set(["line"]),
	pareto_chart: new Set(["bar", "line"]),
	pie_chart: new Set(["pie"]),
	radar_chart: new Set(["radar"]),
	scatter_chart: new Set(["line"]),
	stacked_area_chart: new Set(["line"]),
	stacked_bar_chart: new Set(["bar"]),
	waterfall_chart: new Set(["bar"]),
};

const FLAGS: Record<string, { values: Set<string>; booleans: Set<string> }> = {
	bar: {
		values: new Set(["--data", "--canvas", "--area", "--bar-width", "--value-range"]),
		booleans: new Set(["--horizontal"]),
	},
	line: {
		values: new Set(["--data", "--canvas", "--area", "--x-range", "--y-range"]),
		booleans: new Set(),
	},
	pie: {
		values: new Set(["--data", "--center", "--radius", "--inner-radius", "--start-angle"]),
		booleans: new Set(),
	},
	radar: {
		values: new Set(["--data", "--center", "--radius", "--max-value"]),
		booleans: new Set(),
	},
};

export function getPptChartCalculatorRequestsPath(projectDir: string) {
	return join(projectDir, "analysis", "chart-calculator-requests.json");
}

export function getPptChartCalculatorResultsPath(projectDir: string) {
	return join(projectDir, "validation", "chart-calculator-results.json");
}

export function readAndValidatePptChartCalculatorRequests(projectDir: string) {
	const path = getPptChartCalculatorRequestsPath(projectDir);
	let requests: z.infer<typeof requestsSchema>;
	try {
		requests = requestsSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
	} catch (error) {
		throw new Error(
			`PPT 图表计算请求无效：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const references = listPptDataChartReferences(projectDir);
	assertRequestCoverage(requests.requests, references);
	const commandCount = requests.requests.reduce(
		(total, request) => total + request.commands.length,
		0,
	);
	if (commandCount > Math.max(30, references.length * 12)) {
		throw new Error("PPT 图表计算请求数量异常，已拒绝执行。");
	}
	for (const request of requests.requests) {
		const allowedCalculators = TEMPLATE_CALCULATORS[request.template];
		for (const command of request.commands) {
			if (!allowedCalculators?.has(command.calculator)) {
				throw new Error(
					`PPT 图表页 P${padPage(request.page)} 使用了不匹配的 ${command.calculator} 计算器。`,
				);
			}
			validateCalculatorCommand(command);
		}
	}
	return requests;
}

export async function executePptChartCalculatorRequests(
	projectDir: string,
	skillDir: string,
) {
	const requests = readAndValidatePptChartCalculatorRequests(projectDir);
	const requestJson = `${JSON.stringify(requests, null, 2)}\n`;
	const requestDigest = createHash("sha256").update(requestJson).digest("hex");
	const script = getPptScriptPath("svg_position_calculator.py", skillDir);
	const pages: PptChartCalculatorResults["pages"] = [];
	for (const request of requests.requests) {
		const commands = [];
		for (const command of request.commands) {
			const result = await executePptPython(script, command.args, 60_000, skillDir);
			commands.push({
				calculator: command.calculator,
				args: command.args,
				stdout: result.stdout.slice(0, 100_000),
				stderr: result.stderr.slice(0, 20_000),
				exitCode: 0 as const,
			});
		}
		pages.push({
			id: request.id,
			page: request.page,
			template: request.template,
			verificationMode: request.verificationMode,
			commands,
		});
	}
	const results = resultsSchema.parse({
		schema: "ppt_hosted_chart_calculator_results.v1",
		requestDigest,
		calculatorScript: "scripts/svg_position_calculator.py",
		executedAt: new Date().toISOString(),
		pages,
	});
	const outputPath = getPptChartCalculatorResultsPath(projectDir);
	mkdirSync(join(projectDir, "validation"), { recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(results, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, outputPath);
	return results;
}

export function assertPptChartCalculatorResults(projectDir: string) {
	const requests = readAndValidatePptChartCalculatorRequests(projectDir);
	let results: PptChartCalculatorResults;
	try {
		results = resultsSchema.parse(
			JSON.parse(readFileSync(getPptChartCalculatorResultsPath(projectDir), "utf-8")),
		);
	} catch (error) {
		throw new Error(
			`PPT 图表计算结果无效：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const requestJson = `${JSON.stringify(requests, null, 2)}\n`;
	const digest = createHash("sha256").update(requestJson).digest("hex");
	if (results.requestDigest !== digest) {
		throw new Error("PPT 图表计算结果与当前请求不匹配。");
	}
	if (results.pages.length !== requests.requests.length) {
		throw new Error("PPT 图表计算结果页数不完整。");
	}
	for (const request of requests.requests) {
		const result = results.pages.find((page) => page.id === request.id);
		if (
			!result ||
			result.page !== request.page ||
			result.template !== request.template ||
			result.verificationMode !== request.verificationMode ||
			result.commands.length !== request.commands.length
		) {
			throw new Error(`PPT 图表页 P${padPage(request.page)} 的计算结果不完整。`);
		}
		for (const [index, command] of request.commands.entries()) {
			const resultCommand = result.commands[index];
			if (
				resultCommand.calculator !== command.calculator ||
				resultCommand.args.length !== command.args.length ||
				resultCommand.args.some((arg, argIndex) => arg !== command.args[argIndex])
			) {
				throw new Error(
					`PPT 图表页 P${padPage(request.page)} 的第 ${index + 1} 条计算结果与请求不匹配。`,
				);
			}
		}
	}
	return results;
}

function assertRequestCoverage(
	requests: z.infer<typeof requestsSchema>["requests"],
	references: PptVisualizationReference[],
) {
	const ids = new Set(requests.map((request) => request.id));
	if (ids.size !== requests.length) throw new Error("PPT 图表计算请求包含重复 id。");
	if (requests.length !== references.length) {
		throw new Error(
			`PPT 图表计算请求覆盖不完整：${requests.length}/${references.length} 页。`,
		);
	}
	for (const reference of references) {
		const request = requests.find((item) => item.page === reference.page);
		const allowedModes =
			TEMPLATE_ALLOWED_VERIFICATION_MODES[reference.template];
		if (!request || request.template !== reference.template || !allowedModes) {
			throw new Error(`PPT 图表页 P${padPage(reference.page)} 缺少匹配的计算请求。`);
		}
		if (!allowedModes.has(request.verificationMode)) {
			throw new Error(`PPT 图表页 P${padPage(reference.page)} 的验证模式不正确。`);
		}
		const requiresCalculator = CALCULATOR_REQUIRED_MODES.has(
			request.verificationMode,
		);
		if (requiresCalculator && request.commands.length === 0) {
			throw new Error(`PPT 图表页 P${padPage(reference.page)} 没有实际计算器命令。`);
		}
		if (!requiresCalculator && request.commands.length > 0) {
			throw new Error(`PPT 图表页 P${padPage(reference.page)} 不应伪造计算器命令。`);
		}
	}
	const duplicatePage = requests.find(
		(request, index) =>
			requests.findIndex((candidate) => candidate.page === request.page) !== index,
	);
	if (duplicatePage) {
		throw new Error(`PPT 图表计算请求重复覆盖 P${padPage(duplicatePage.page)}。`);
	}
}

function validateCalculatorCommand(command: z.infer<typeof commandSchema>) {
	if (command.args[0] !== "calc" || command.args[1] !== command.calculator) {
		throw new Error("PPT 图表计算命令必须调用声明的 calc 子命令。");
	}
	const flags = FLAGS[command.calculator];
	let hasData = false;
	const seenFlags = new Set<string>();
	for (let index = 2; index < command.args.length; index += 1) {
		const flag = command.args[index];
		if (seenFlags.has(flag)) {
			throw new Error(`PPT 图表计算命令重复声明参数：${flag}。`);
		}
		seenFlags.add(flag);
		if (flags.booleans.has(flag)) continue;
		if (!flags.values.has(flag)) {
			throw new Error(`PPT 图表计算命令包含不允许的参数：${flag}。`);
		}
		const value = command.args[index + 1];
		if (!value || value.startsWith("--") || /[\0\r\n]/.test(value)) {
			throw new Error(`PPT 图表计算命令参数 ${flag} 缺少合法值。`);
		}
		if (flag === "--data") hasData = true;
		index += 1;
	}
	if (!hasData) throw new Error("PPT 图表计算命令缺少 --data。");
}

function padPage(page: number) {
	return String(page).padStart(2, "0");
}
