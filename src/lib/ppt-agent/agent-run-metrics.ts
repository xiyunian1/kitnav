import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { AgentUsage } from "./agent-runtime";

export type PptAgentRunStatus = "ok" | "recovered" | "error" | "timeout" | "stalled" | "cancelled";

export interface PptAgentRunRecord {
	projectId: string;
	phase: string;
	sessionId: string;
	turn: number;
	model?: string;
	status: PptAgentRunStatus;
	stopReason?: string;
	numTurns?: number;
	usage: AgentUsage;
	toolCalls: number;
	durationMs: number;
	error?: string;
}

const MAX_ERROR_CHARS = 2000;

/** 写入一条运行记录。观测数据不能影响生成流程，写库失败只记日志。 */
export async function recordPptAgentRun(record: PptAgentRunRecord) {
	try {
		await prisma.pptAgentRun.create({
			data: {
				projectId: record.projectId,
				phase: record.phase.slice(0, 64),
				sessionId: record.sessionId.slice(0, 128),
				turn: record.turn,
				model: record.model?.slice(0, 128) || null,
				status: record.status,
				stopReason: record.stopReason?.slice(0, 64) || null,
				numTurns: Math.max(0, Math.round(record.numTurns ?? 0)),
				llmCalls: record.usage.llmCalls,
				usageReported: record.usage.reported,
				inputTokens: Math.round(record.usage.inputTokens),
				outputTokens: Math.round(record.usage.outputTokens),
				cacheReadTokens: Math.round(record.usage.cacheReadTokens),
				cacheWriteTokens: Math.round(record.usage.cacheWriteTokens),
				cost: record.usage.cost,
				toolCalls: record.toolCalls,
				durationMs: Math.max(0, Math.round(record.durationMs)),
				error: record.error?.slice(0, MAX_ERROR_CHARS) || null,
			},
		});
	} catch (error) {
		logger.warn("ppt-agent-metrics", "写入 agent 运行记录失败", {
			projectId: record.projectId,
			phase: record.phase,
			error,
		});
	}
}

/** 把 runCommand 终止时的错误归类，便于统计超时、卡死和用户取消各占多少。 */
export function classifyPptAgentFailure(error: unknown, cancelled: boolean): PptAgentRunStatus {
	if (cancelled) return "cancelled";
	const message = error instanceof Error ? error.message : String(error ?? "");
	if (message.includes("执行超时")) return "timeout";
	if (message.includes("没有生成或更新关键产物")) return "stalled";
	return "error";
}

export interface PptAgentRunRow {
	phase: string;
	status: string;
	llmCalls: number;
	usageReported: boolean;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	durationMs: number;
}

export interface PptAgentRunTotals {
	runs: number;
	llmCalls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	cost: number;
	durationMs: number;
	/** 有用量上报的运行占比；为 0 时 token 和费用不可信。 */
	usageReportedRatio: number;
	/** 输入 token 中命中缓存的比例（cacheRead / (input + cacheRead)）。 */
	cacheHitRatio: number;
}

export interface PptAgentPhaseSummary extends PptAgentRunTotals {
	phase: string;
	costShare: number;
	durationShare: number;
}

export interface PptAgentRunSummary {
	totals: PptAgentRunTotals;
	byPhase: PptAgentPhaseSummary[];
	statusCounts: Record<string, number>;
}

function emptyTotals(): PptAgentRunTotals {
	return {
		runs: 0,
		llmCalls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0,
		durationMs: 0,
		usageReportedRatio: 0,
		cacheHitRatio: 0,
	};
}

function addRun(totals: PptAgentRunTotals, run: PptAgentRunRow, reported: { count: number }) {
	totals.runs += 1;
	totals.llmCalls += run.llmCalls;
	totals.inputTokens += run.inputTokens;
	totals.outputTokens += run.outputTokens;
	totals.cacheReadTokens += run.cacheReadTokens;
	totals.cacheWriteTokens += run.cacheWriteTokens;
	totals.cost += run.cost;
	totals.durationMs += run.durationMs;
	if (run.usageReported) reported.count += 1;
}

function finish(totals: PptAgentRunTotals, reported: number) {
	totals.usageReportedRatio = totals.runs ? reported / totals.runs : 0;
	const promptTokens = totals.inputTokens + totals.cacheReadTokens;
	totals.cacheHitRatio = promptTokens ? totals.cacheReadTokens / promptTokens : 0;
}

/** 汇总一组运行记录：总量、各阶段用量与占比、各结束状态的次数。 */
export function summarizePptAgentRuns(runs: PptAgentRunRow[]): PptAgentRunSummary {
	const totals = emptyTotals();
	const totalReported = { count: 0 };
	const phases = new Map<string, { totals: PptAgentRunTotals; reported: { count: number } }>();
	const statusCounts: Record<string, number> = {};
	for (const run of runs) {
		addRun(totals, run, totalReported);
		const entry = phases.get(run.phase) ?? { totals: emptyTotals(), reported: { count: 0 } };
		addRun(entry.totals, run, entry.reported);
		phases.set(run.phase, entry);
		statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
	}
	finish(totals, totalReported.count);
	const byPhase = [...phases.entries()]
		.map(([phase, entry]) => {
			finish(entry.totals, entry.reported.count);
			return {
				phase,
				...entry.totals,
				costShare: totals.cost ? entry.totals.cost / totals.cost : 0,
				durationShare: totals.durationMs ? entry.totals.durationMs / totals.durationMs : 0,
			};
		})
		.sort((a, b) => b.durationMs - a.durationMs);
	return { totals, byPhase, statusCounts };
}

/** 阶段名与 agent-runner 中 buildPptPhaseSessionId 的取值一致。 */
export const PPT_AGENT_PHASE_LABELS: Record<string, string> = {
	initial: "方案规划",
	"confirmed-planning": "确认后规划",
	"image-generator": "图片规划",
	executor: "逐页生成",
	"chart-verification": "图表校准",
	"chart-reverification": "图表复校",
	review: "视觉复核",
	agent: "其他",
};

export function pptAgentPhaseLabel(phase: string) {
	return PPT_AGENT_PHASE_LABELS[phase] ?? phase;
}
