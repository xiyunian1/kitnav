import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PptAgentToolCall } from "./execution-evidence";
import {
	discardPptExecutionCheckpoint,
	loadPptExecutionCheckpoint,
	restorePptExecutionCheckpoint,
	savePptExecutionCheckpoint,
} from "./execution-checkpoint";
import { createPptAgentContextBundle } from "./agent-context-bundle";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT execution checkpoints", () => {
	it("restores the last verified SVG snapshot and tool evidence", () => {
		const root = createProject();
		const checkpoint = savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: executionCalls(),
			toolCaptureComplete: true,
		});
		expect(checkpoint).not.toBeNull();

		writeFileSync(join(root, "svg_output", "01_slide.svg"), "dirty");
		mkdirSync(join(root, "notes"), { recursive: true });
		writeFileSync(join(root, "notes", "total.md"), "unfinished");
		writeFileSync(join(root, "validation", "stale.json"), "{}");
		restorePptExecutionCheckpoint(root, checkpoint!);

		expect(readFileSync(join(root, "svg_output", "01_slide.svg"), "utf-8")).toBe(
			"<svg></svg>",
		);
		expect(existsSync(join(root, "notes", "total.md"))).toBe(false);
		expect(existsSync(join(root, "validation", "stale.json"))).toBe(false);
		expect(
			existsSync(join(root, "validation", "execution-evidence.json")),
		).toBe(true);

		const loaded = loadPptExecutionCheckpoint(root, 1);
		expect(loaded).toMatchObject({
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			svgCount: 1,
		});
	});

	it("rejects a checkpoint after its resumable Pi session is removed", () => {
		const root = createProject();
		savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: executionCalls(),
			toolCaptureComplete: true,
		});
		rmSync(join(root, ".pi-sessions"), { recursive: true, force: true });

		expect(() => loadPptExecutionCheckpoint(root, 1)).toThrow(
			"对应的 Pi 会话已不存在",
		);
	});

	it("persists injected executor context evidence across resume", () => {
		const root = createProject();
		const context = createPptAgentContextBundle({
			projectDir: root,
			phase: "executor",
			sourcePaths: [
				join(root, "design_spec.md"),
				join(root, "sources", "source.md"),
			],
		});
		expect(context).not.toBeNull();
		const calls = [
			call("read-lock", "read", 1, 2, "spec_lock.md"),
			call("write-slide", "write", 3, 4, "svg_output/01_slide.svg"),
		];
		const checkpoint = savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: calls,
			toolCaptureComplete: true,
			contextBundle: context!.manifest,
		});

		expect(checkpoint?.contextBundle?.bundleSha256).toBe(
			context!.manifest.bundleSha256,
		);
		expect(loadPptExecutionCheckpoint(root, 1)?.contextBundle).toEqual(
			context!.manifest,
		);
		expect(() => restorePptExecutionCheckpoint(root, checkpoint!)).not.toThrow();
	});

	it("does not publish a checkpoint for invalid SVG output", () => {
		const root = createProject();
		writeFileSync(join(root, "svg_output", "01_slide.svg"), "not svg");

		expect(() =>
			savePptExecutionCheckpoint({
				projectDir: root,
				sessionId: "project-executor-a0-lease",
				stopReason: "length",
				turn: 1,
				expectedSlideCount: 1,
				toolCalls: executionCalls(),
				toolCaptureComplete: true,
			}),
		).toThrow("不是有效 SVG");
		expect(
			existsSync(join(root, "validation", "execution-checkpoint.json")),
		).toBe(false);
	});

	it("keeps current output unchanged when a snapshot is damaged", () => {
		const root = createProject();
		const checkpoint = savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: executionCalls(),
			toolCaptureComplete: true,
		});
		expect(checkpoint).not.toBeNull();

		writeFileSync(
			join(root, "svg_output", "01_slide.svg"),
			"<svg><text>current</text></svg>",
		);
		writeFileSync(
			join(checkpoint!.snapshotDir, "svg_output", "01_slide.svg"),
			"broken",
		);

		expect(() => restorePptExecutionCheckpoint(root, checkpoint!)).toThrow(
			"不是有效 SVG",
		);
		expect(readFileSync(join(root, "svg_output", "01_slide.svg"), "utf-8")).toBe(
			"<svg><text>current</text></svg>",
		);
	});

	it("rejects malformed persisted tool-call metadata", () => {
		const root = createProject();
		savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: executionCalls(),
			toolCaptureComplete: true,
		});
		const pointerPath = join(
			root,
			"validation",
			"execution-checkpoint.json",
		);
		const pointer = JSON.parse(readFileSync(pointerPath, "utf-8")) as Record<
			string,
			unknown
		>;
		pointer.toolCalls = [null];
		writeFileSync(pointerPath, `${JSON.stringify(pointer)}\n`);

		expect(() => loadPptExecutionCheckpoint(root, 1)).toThrow(
			"检查点格式无效",
		);
	});

	it("discards resumable snapshots without deleting execution evidence", () => {
		const root = createProject();
		savePptExecutionCheckpoint({
			projectDir: root,
			sessionId: "project-executor-a0-lease",
			stopReason: "length",
			turn: 1,
			expectedSlideCount: 1,
			toolCalls: executionCalls(),
			toolCaptureComplete: true,
		});

		discardPptExecutionCheckpoint(root);

		expect(
			existsSync(join(root, "validation", "execution-checkpoint.json")),
		).toBe(false);
		expect(
			existsSync(join(root, "validation", "executor-checkpoints")),
		).toBe(false);
		expect(
			existsSync(join(root, "validation", "execution-evidence.json")),
		).toBe(true);
	});
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-executor-checkpoint-"));
	roots.push(root);
	for (const directory of ["sources", "svg_output", ".pi-sessions"]) {
		mkdirSync(join(root, directory), { recursive: true });
	}
	writeFileSync(join(root, "design_spec.md"), "design");
	writeFileSync(join(root, "spec_lock.md"), "lock");
	writeFileSync(join(root, "sources", "source.md"), "source");
	writeFileSync(join(root, "svg_output", "01_slide.svg"), "<svg></svg>");
	writeFileSync(
		join(
			root,
			".pi-sessions",
			"2026-07-23T00-00-00-000Z_project-executor-a0-lease.jsonl",
		),
		"{}\n",
	);
	return root;
}

function executionCalls(): PptAgentToolCall[] {
	return [
		call("read-design", "read", 1, 2, "design_spec.md"),
		call("read-source", "read", 3, 4, "sources/source.md"),
		call("read-lock", "read", 5, 6, "spec_lock.md"),
		call("write-slide", "write", 7, 8, "svg_output/01_slide.svg"),
	];
}

function call(
	toolCallId: string,
	toolName: string,
	startEventIndex: number,
	endEventIndex: number,
	path: string,
): PptAgentToolCall {
	return {
		toolCallId,
		toolName,
		path,
		startEventIndex,
		endEventIndex,
		completed: true,
		success: true,
	};
}
