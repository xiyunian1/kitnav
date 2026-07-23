import { describe, expect, it } from "vitest";
import {
	parsePptConfirmationTimingFromLogs,
	resolvePptActiveGenerationTiming,
	resolvePptConfirmationTiming,
} from "./timing";

describe("PPT confirmation timing", () => {
	it("recovers a completed legacy wait interval from project logs", () => {
		const timing = parsePptConfirmationTimingFromLogs(
			[
				"[2026-07-21T01:00:00.000Z] 设计方案候选已生成，等待用户确认后继续",
				"[2026-07-21T01:04:34.000Z] 用户已确认设计方案，原任务重新入队",
			].join("\n"),
		);

		expect(timing).toEqual({
			confirmationWaitDurationMs: 274_000,
			confirmationWaitStartedAt: null,
		});
	});

	it("keeps an unmatched wait interval open", () => {
		const timing = parsePptConfirmationTimingFromLogs(
			"[2026-07-21T01:00:00.000Z] 模板填充方案候选已生成，等待用户确认后继续",
		);

		expect(timing.confirmationWaitDurationMs).toBe(0);
		expect(timing.confirmationWaitStartedAt?.toISOString()).toBe(
			"2026-07-21T01:00:00.000Z",
		);
	});

	it("prefers durable timing when verbose legacy logs were truncated", () => {
		const timing = resolvePptConfirmationTiming({
			logs: "[2026-07-21T01:04:34.000Z] 用户已确认设计方案，原任务重新入队",
			confirmationWaitSeconds: 274,
		});

		expect(timing.confirmationWaitDurationMs).toBe(274_000);
	});

	it("does not reopen a durably closed wait from an incomplete old log", () => {
		const timing = resolvePptConfirmationTiming({
			logs: "[2026-07-21T01:00:00.000Z] 设计方案候选已生成，等待用户确认后继续",
			confirmationWaitSeconds: 274,
			confirmationWaitStartedAt: null,
		});

		expect(timing.confirmationWaitStartedAt).toBeNull();
	});

	it("sums multiple legacy confirmation waits", () => {
		const timing = parsePptConfirmationTimingFromLogs(
			[
				"[2026-07-21T01:00:00.000Z] 设计方案候选已生成，等待用户确认后继续",
				"[2026-07-21T01:01:00.000Z] 用户已确认设计方案，原任务重新入队",
				"[2026-07-21T01:02:00.000Z] 模板页面方案候选已生成，等待用户确认后继续",
				"[2026-07-21T01:04:00.000Z] 用户已确认模板页面方案，原任务重新入队",
			].join("\n"),
		);

		expect(timing.confirmationWaitDurationMs).toBe(180_000);
	});

	it("normalizes stored active worker time", () => {
		expect(
			resolvePptActiveGenerationTiming({
				activeGenerationSeconds: 125.9,
				activeGenerationStartedAt: "2026-07-23T01:00:00.000Z",
			}),
		).toEqual({
			activeGenerationDurationMs: 125_000,
			activeGenerationStartedAt: new Date("2026-07-23T01:00:00.000Z"),
		});
	});
});
