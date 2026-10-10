import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	AgentResultMetadataCollector,
	buildPptAttemptSessionId,
	parsePptSessionPhase,
} from "./agent-runtime";
import {
	classifyPptAgentFailure,
	pptAgentPhaseLabel,
	summarizePptAgentRuns,
	type PptAgentRunRow,
} from "./agent-run-metrics";
import { resolvePptModelPricing } from "./pi-agent-config";

function assistant(timestamp: number, usage: Record<string, unknown>) {
	return { role: "assistant", content: [], timestamp, responseId: `r-${timestamp}`, usage };
}

const fullUsage = (input: number, output: number, cacheRead = 0, cost = 0) => ({
	input,
	output,
	cacheRead,
	cacheWrite: 0,
	totalTokens: input + output + cacheRead,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
});

describe("PPT agent usage collection", () => {
	it("counts each completed reply once and ignores partial streaming updates", () => {
		const collector = new AgentResultMetadataCollector("s");
		const first = assistant(1, fullUsage(1000, 200, 3000, 0.012));
		const second = assistant(2, fullUsage(500, 100, 0, 0.004));
		for (const event of [
			{ type: "message_start", message: assistant(1, fullUsage(0, 0)) },
			{ type: "message_update", message: assistant(1, fullUsage(1000, 5)) },
			{ type: "message_end", message: first },
			{ type: "turn_end", message: first, toolResults: [] },
			{ type: "message_end", message: second },
			{ type: "turn_end", message: second, toolResults: [] },
			// agent_end 可能带有续跑前的历史消息，不应重复计入
			{ type: "agent_end", messages: [assistant(0, fullUsage(9999, 9999)), first, second] },
		]) {
			collector.consumeJsonLine(JSON.stringify(event));
		}

		const { usage, numTurns } = collector.getMetadata();
		expect(numTurns).toBe(2);
		expect(usage).toMatchObject({
			llmCalls: 2,
			reported: true,
			inputTokens: 1500,
			outputTokens: 300,
			cacheReadTokens: 3000,
		});
		expect(usage.cost).toBeCloseTo(0.016);
	});

	it("parses a real pi --mode json transcript (DeepSeek, usage in streaming disabled)", () => {
		// 真实输出：pi 0.80.2 + deepseek-flash，单价按 input 2 / output 8 元每百万 token 配置
		const transcript = readFileSync(join(__dirname, "__fixtures__", "pi-json-deepseek.jsonl"), "utf-8");
		const collector = new AgentResultMetadataCollector("s");
		for (const line of transcript.split("\n")) if (line.trim()) collector.consumeJsonLine(line);
		const metadata = collector.getMetadata();
		expect(metadata.stopReason).toBe("stop");
		expect(metadata.usage).toMatchObject({ llmCalls: 1, reported: true, inputTokens: 558, outputTokens: 46 });
		expect(metadata.usage.cost).toBeCloseTo(0.001484);
	});

	it("marks usage as not reported when the provider sends only zeros", () => {
		const collector = new AgentResultMetadataCollector("s");
		collector.consumeJsonLine(JSON.stringify({ type: "message_end", message: assistant(1, fullUsage(0, 0)) }));
		expect(collector.getMetadata().usage).toMatchObject({ llmCalls: 1, reported: false, inputTokens: 0 });
	});

	it("recovers the phase from attempt session ids", () => {
		const sessionId = buildPptAttemptSessionId({
			projectId: "cm1x9",
			phase: "confirmed-planning",
			retryAttempt: 2,
			workerLease: "fd4a9da2-029a-4f5a-a3a0",
		});
		expect(parsePptSessionPhase("cm1x9", sessionId)).toBe("confirmed-planning");
		expect(
			parsePptSessionPhase("cm1x9", buildPptAttemptSessionId({ projectId: "cm1x9", phase: "image-generator", workerLease: "a1-b2" })),
		).toBe("image-generator");
		expect(parsePptSessionPhase("cm1x9", "cm1x9")).toBe("agent");
		expect(parsePptSessionPhase("cm1x9", "other-executor-a0-x")).toBe("agent");
	});
});

describe("PPT model pricing", () => {
	it("reads per-model prices with a wildcard default and ignores invalid values", () => {
		const env = {
			PPT_PI_MODEL_PRICING: JSON.stringify({
				"deepseek-v4-pro": { input: 4, output: 16, cacheRead: 1 },
				"*": { input: 2, output: -3, cacheWrite: "x" },
			}),
		};
		expect(resolvePptModelPricing("deepseek-v4-pro", env)).toEqual({ input: 4, output: 16, cacheRead: 1, cacheWrite: 0 });
		expect(resolvePptModelPricing("other", env)).toEqual({ input: 2, output: 0, cacheRead: 0, cacheWrite: 0 });
		expect(resolvePptModelPricing("any", { PPT_PI_MODEL_PRICING: "not json" })).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(resolvePptModelPricing("any", {})).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	});
});

describe("PPT agent run summary", () => {
	const run = (phase: string, status: string, durationMs: number, cost: number, input = 100, cacheRead = 0): PptAgentRunRow => ({
		phase,
		status,
		llmCalls: 2,
		usageReported: input > 0,
		inputTokens: input,
		outputTokens: 10,
		cacheReadTokens: cacheRead,
		cacheWriteTokens: 0,
		cost,
		durationMs,
	});

	it("aggregates totals, per-phase shares and status counts", () => {
		const summary = summarizePptAgentRuns([
			run("initial", "ok", 1000, 0.1),
			run("executor", "ok", 6000, 0.6, 300, 900),
			run("executor", "stalled", 2000, 0.2),
			run("review", "error", 1000, 0, 0),
		]);
		expect(summary.totals).toMatchObject({ runs: 4, inputTokens: 500, cacheReadTokens: 900, durationMs: 10_000 });
		expect(summary.totals.cost).toBeCloseTo(0.9);
		expect(summary.totals.usageReportedRatio).toBeCloseTo(0.75);
		expect(summary.totals.cacheHitRatio).toBeCloseTo(900 / 1400);
		expect(summary.byPhase.map((p) => p.phase)).toEqual(["executor", "initial", "review"]);
		expect(summary.byPhase[0].durationShare).toBeCloseTo(0.8);
		expect(summary.byPhase[0].costShare).toBeCloseTo(0.8 / 0.9);
		expect(summary.statusCounts).toEqual({ ok: 2, stalled: 1, error: 1 });
	});

	it("classifies termination reasons", () => {
		expect(classifyPptAgentFailure(new Error("x"), true)).toBe("cancelled");
		expect(classifyPptAgentFailure(new Error("PPT Master agent 执行超时（30 分钟）。"), false)).toBe("timeout");
		expect(classifyPptAgentFailure(new Error("连续 15 分钟没有生成或更新关键产物"), false)).toBe("stalled");
		expect(classifyPptAgentFailure("boom", false)).toBe("error");
	});

	it("labels known phases and passes through unknown ones", () => {
		expect(pptAgentPhaseLabel("executor")).toBe("逐页生成");
		expect(pptAgentPhaseLabel("custom-phase")).toBe("custom-phase");
	});
});
