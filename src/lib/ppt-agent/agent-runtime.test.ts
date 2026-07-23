import { describe, expect, it } from "vitest";
import {
	AgentResultMetadataCollector,
	buildPptAttemptSessionId,
	buildPptExecutorContinuePrompt,
	createPptArtifactWatchdogState,
	createPptExecutorProgressState,
	createPptStageProgressState,
	extractAgentResultMetadata,
	isPptArtifactWatchdogExpired,
	isPptExecutorStalled,
	isPptStageProgressStalled,
	recordPptArtifactWatchdogProgress,
	recordPptExecutorProgress,
	recordPptStageProgress,
	resolvePptExecutorMaxNoProgressTurns,
	resolvePptNoArtifactTimeoutMs,
} from "./agent-runtime";

describe("PPT agent runtime", () => {
	it("isolates every phase session by retry attempt and worker lease", () => {
		expect(
			buildPptAttemptSessionId({
				projectId: "project-1",
				phase: "confirmed-planning",
				retryAttempt: 2,
				workerLease: "fd4a9da2-029a-4f5a-a3a0",
			}),
		).toBe("project-1-confirmed-planning-a2-fd4a9da2-029");
	});

	it("keeps the requested session ID when the captured output tail loses the session event", () => {
		const fullOutput = [
			JSON.stringify({ type: "session", id: "project-executor" }),
			"x".repeat(600_000),
			JSON.stringify({
				type: "result",
				session_id: "wrong-planning-session",
				stop_reason: "length",
				num_turns: 9,
			}),
		].join("\n");
		const boundedTail = fullOutput.slice(-500_000);

		expect(
			extractAgentResultMetadata(boundedTail, "project-executor"),
		).toMatchObject({
			sessionId: "project-executor",
			stopReason: "length",
			numTurns: 9,
		});
	});

	it("does not replace a specific stop reason with agent_end", () => {
		const output = [
			JSON.stringify({ type: "result", stop_reason: "length" }),
			JSON.stringify({ type: "agent_end", messages: [] }),
		].join("\n");

		expect(extractAgentResultMetadata(output, "executor").stopReason).toBe(
			"length",
		);
	});

	it("reads the real stop reason from the last assistant in a Pi agent_end event", () => {
		const output = JSON.stringify({
			type: "agent_end",
			messages: [
				{
					role: "assistant",
					stopReason: "length",
					content: [{ type: "text", text: "partial" }],
				},
			],
		});

		expect(extractAgentResultMetadata(output, "executor")).toMatchObject({
			stopReason: "length",
			resultText: "partial",
		});
	});

	it("collects metadata incrementally before the bounded output tail is built", () => {
		const collector = new AgentResultMetadataCollector("executor");
		collector.consumeJsonLine(
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					stopReason: "tool_use",
					content: [{ type: "text", text: "continue" }],
				},
			}),
		);
		collector.consumeJsonLine(JSON.stringify({ type: "turn_end" }));
		collector.consumeJsonLine(JSON.stringify({ type: "agent_end", messages: [] }));

		expect(collector.getMetadata()).toMatchObject({
			sessionId: "executor",
			stopReason: "tool_use",
			numTurns: 1,
			resultText: "continue",
		});
	});

	it("stops after two consecutive turns without a new SVG", () => {
		let progress = createPptExecutorProgressState();
		progress = recordPptExecutorProgress(progress, 0);
		expect(isPptExecutorStalled(progress, 10, 2)).toBe(false);

		progress = recordPptExecutorProgress(progress, 0);
		expect(isPptExecutorStalled(progress, 10, 2)).toBe(true);
	});

	it("resets the no-progress counter whenever a new SVG appears", () => {
		let progress = createPptExecutorProgressState();
		progress = recordPptExecutorProgress(progress, 0);
		progress = recordPptExecutorProgress(progress, 1);
		expect(progress).toEqual({
			svgCount: 1,
			speakerNotesComplete: false,
			qualityValid: false,
			artifactSignature: "",
			qualityErrorCount: null,
			consecutiveNoProgressTurns: 0,
		});

		progress = recordPptExecutorProgress(progress, 1);
		progress = recordPptExecutorProgress(progress, 2);
		expect(progress).toEqual({
			svgCount: 2,
			speakerNotesComplete: false,
			qualityValid: false,
			artifactSignature: "",
			qualityErrorCount: null,
			consecutiveNoProgressTurns: 0,
		});
	});

	it("also stops when all SVG pages exist but speaker notes never complete", () => {
		let progress = createPptExecutorProgressState(10);
		progress = recordPptExecutorProgress(progress, 10, false);
		progress = recordPptExecutorProgress(progress, 10, false);
		expect(isPptExecutorStalled(progress, 10, 2)).toBe(true);
		progress = recordPptExecutorProgress(progress, 10, true);
		expect(progress.consecutiveNoProgressTurns).toBe(0);
	});

	it("treats a newly valid quality result as executor progress", () => {
		let progress = createPptExecutorProgressState(10, true);
		progress = recordPptExecutorProgress(progress, 10, true, false);
		expect(progress.consecutiveNoProgressTurns).toBe(1);
		progress = recordPptExecutorProgress(progress, 10, true, true);
		expect(progress).toEqual({
			svgCount: 10,
			speakerNotesComplete: true,
			qualityValid: true,
			artifactSignature: "",
			qualityErrorCount: 0,
			consecutiveNoProgressTurns: 0,
		});
		expect(isPptExecutorStalled(progress, 10, 2)).toBe(false);
	});

	it("treats changed SVG content as executor progress", () => {
		let progress = createPptExecutorProgressState(
			10,
			true,
			false,
			"before",
			3,
		);
		progress = recordPptExecutorProgress(
			progress,
			10,
			true,
			false,
			"after",
			3,
		);
		expect(progress.consecutiveNoProgressTurns).toBe(0);
	});

	it("treats fewer quality errors as executor progress", () => {
		let progress = createPptExecutorProgressState(
			10,
			true,
			false,
			"same",
			3,
		);
		progress = recordPptExecutorProgress(
			progress,
			10,
			true,
			false,
			"same",
			1,
		);
		expect(progress.consecutiveNoProgressTurns).toBe(0);
	});

	it("counts a turn as stalled only when artifacts and errors are unchanged", () => {
		let progress = createPptExecutorProgressState(
			10,
			true,
			false,
			"same",
			2,
		);
		progress = recordPptExecutorProgress(
			progress,
			10,
			true,
			false,
			"same",
			2,
		);
		expect(progress.consecutiveNoProgressTurns).toBe(1);
		progress = recordPptExecutorProgress(
			progress,
			10,
			true,
			false,
			"same",
			2,
		);
		expect(isPptExecutorStalled(progress, 10, 2)).toBe(true);
	});

	it("directs a length-limited continuation to write the first page", () => {
		const prompt = buildPptExecutorContinuePrompt({
			turn: 2,
			slideCount: 10,
			svgCount: 0,
			hasSpecLock: true,
			stopReason: "length",
		});

		expect(prompt).toContain("当前 Executor 会话已保留");
		expect(prompt).toContain("禁止重新读取 SKILL.md");
		expect(prompt).toContain("直接写入第 1 页 SVG");
	});

	it("passes host quality failures back to the Executor for targeted repair", () => {
		const prompt = buildPptExecutorContinuePrompt({
			turn: 3,
			slideCount: 5,
			svgCount: 5,
			hasSpecLock: true,
			stopReason: "end_turn",
			qualityErrors: [
				'02.svg："辅助说明一" 与 "辅助说明二" 可能重叠',
				"PowerPoint 字体兼容性错误：Aptos",
			],
		});

		expect(prompt).toContain("宿主质量检查发现 2 项");
		expect(prompt).toContain("02.svg");
		expect(prompt).toContain("PowerPoint 字体兼容性错误");
		expect(prompt).toContain("只修改涉及的 SVG");
	});

	it("uses a bounded configurable no-progress limit", () => {
		expect(resolvePptExecutorMaxNoProgressTurns("")).toBe(2);
		expect(resolvePptExecutorMaxNoProgressTurns("4")).toBe(4);
		expect(resolvePptExecutorMaxNoProgressTurns("100")).toBe(10);
	});

	it("expires an artifact watchdog only when the signature remains unchanged", () => {
		let watchdog = createPptArtifactWatchdogState("none", 1_000);
		expect(isPptArtifactWatchdogExpired(watchdog, 60_000, 60_000)).toBe(false);
		watchdog = recordPptArtifactWatchdogProgress(watchdog, "slide-1", 50_000);
		expect(isPptArtifactWatchdogExpired(watchdog, 109_999, 60_000)).toBe(false);
		expect(isPptArtifactWatchdogExpired(watchdog, 110_000, 60_000)).toBe(true);
		expect(resolvePptNoArtifactTimeoutMs("1000")).toBe(60_000);
	});

	it("stops a stage-based workflow after repeated turns at the same stage", () => {
		let progress = createPptStageProgressState(1);
		progress = recordPptStageProgress(progress, 1);
		expect(isPptStageProgressStalled(progress, 2)).toBe(false);
		progress = recordPptStageProgress(progress, 1);
		expect(isPptStageProgressStalled(progress, 2)).toBe(true);
		progress = recordPptStageProgress(progress, 2);
		expect(progress.consecutiveNoProgressTurns).toBe(0);
	});
});
