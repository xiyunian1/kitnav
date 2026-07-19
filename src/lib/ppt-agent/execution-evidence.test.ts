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
	PptAgentToolCallCollector,
	type PptAgentToolCall,
	writePptExecutionEvidence,
} from "./execution-evidence";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT hosted execution evidence", () => {
	it("collects successful PI tool calls without retaining write content", () => {
		const collector = new PptAgentToolCallCollector();
		collector.consumeJsonLine(
			JSON.stringify({
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "write",
				args: { path: "svg_output/01_slide.svg", content: "secret svg" },
			}),
		);
		collector.consumeJsonLine(
			JSON.stringify({
				type: "tool_execution_end",
				toolCallId: "call-1",
				toolName: "write",
				isError: false,
			}),
		);

		expect(collector.isComplete()).toBe(true);
		expect(collector.getCalls()).toEqual([
			expect.objectContaining({
				path: "svg_output/01_slide.svg",
				completed: true,
				success: true,
			}),
		]);
		expect(JSON.stringify(collector.getCalls())).not.toContain("secret svg");
	});

	it("requires batch template reads and one fresh spec read per sequential page", () => {
		const root = createProject();
		const calls = successfulCalls([
			["read", ".ppt-master-skill/templates/cover.svg"],
			["read", ".ppt-master-skill/templates/charts/column_chart.svg"],
			["read", "spec_lock.md"],
			["write", "svg_output/01_slide.svg"],
			["read", "spec_lock.md"],
			["write", "svg_output/02_slide.svg"],
		]);

		const evidence = writePptExecutionEvidence(root, calls, 2);
		expect(evidence.pages.map((page) => page.page)).toEqual([1, 2]);
		expect(evidence.batchReads).toHaveLength(2);
	});

		it("rejects a reused spec read or any out-of-order page mutation", () => {
		const root = createProject(false);
		expect(() =>
			writePptExecutionEvidence(
				root,
				successfulCalls([
					["read", "spec_lock.md"],
					["write", "svg_output/01_slide.svg"],
					["write", "svg_output/02_slide.svg"],
				]),
				2,
			),
		).toThrow("P02 前没有独立完整读取");

		expect(() =>
			writePptExecutionEvidence(
				root,
				successfulCalls([
					["read", "spec_lock.md"],
					["write", "svg_output/02_slide.svg"],
					["read", "spec_lock.md"],
					["write", "svg_output/01_slide.svg"],
				]),
				2,
			),
			).toThrow("不符合严格逐页顺序");

			expect(() =>
				writePptExecutionEvidence(
					root,
					successfulCalls([
						["read", "spec_lock.md"],
						["write", "svg_output/01_slide.svg"],
						["read", "spec_lock.md"],
						["write", "svg_output/02_slide.svg"],
						["edit", "svg_output/01_slide.svg"],
					]),
					2,
				),
			).toThrow("开始 P02 后又回头修改 P01");
		});

	it("requires the mapped external template base before each page", () => {
		const root = createProject(false);
		mkdirSync(join(root, "template_refs"), { recursive: true });
		writeFileSync(join(root, "template_refs", "template-map.md"), "mapped");
		expect(() =>
			writePptExecutionEvidence(
				root,
				successfulCalls([
					["read", "spec_lock.md"],
					["write", "svg_output/01_slide.svg"],
					["read", "spec_lock.md"],
					["write", "svg_output/02_slide.svg"],
				]),
				2,
			),
		).toThrow("外部模板底稿");
	});

	it("rejects a spec read that had not completed before the SVG write started", () => {
		const root = createProject(false);
		const collector = new PptAgentToolCallCollector();
		collector.consumeJsonLine(toolStart("read-1", "read", "spec_lock.md"));
		collector.consumeJsonLine(
			toolStart("write-1", "write", "svg_output/01_slide.svg"),
		);
		collector.consumeJsonLine(toolEnd("read-1"));
		collector.consumeJsonLine(toolEnd("write-1"));

		expect(() =>
			writePptExecutionEvidence(root, collector.getCalls(), 1),
		).toThrow("没有独立完整读取 spec_lock.md");
	});

	it("rejects partial spec reads and overlapping page writes", () => {
		const partialRoot = createProject(false);
		const partialCalls = successfulCalls([
			["read", "spec_lock.md"],
			["write", "svg_output/01_slide.svg"],
		]);
		partialCalls[0].limit = 1;
		expect(() => writePptExecutionEvidence(partialRoot, partialCalls, 1)).toThrow(
			"没有独立完整读取 spec_lock.md",
		);

		const overlappingRoot = createProject(false);
		const collector = new PptAgentToolCallCollector();
		collector.consumeJsonLine(toolStart("read-1", "read", "spec_lock.md"));
		collector.consumeJsonLine(toolEnd("read-1"));
		collector.consumeJsonLine(
			toolStart("write-1", "write", "svg_output/01_slide.svg"),
		);
		collector.consumeJsonLine(toolStart("read-2", "read", "spec_lock.md"));
		collector.consumeJsonLine(toolEnd("read-2"));
		collector.consumeJsonLine(
			toolStart("write-2", "write", "svg_output/02_slide.svg"),
		);
		collector.consumeJsonLine(toolEnd("write-1"));
		collector.consumeJsonLine(toolEnd("write-2"));

		expect(() =>
			writePptExecutionEvidence(overlappingRoot, collector.getCalls(), 2),
		).toThrow("P01 写入完成前已开始 P02");
	});

	it("requires official executor references and project inputs before the first SVG", () => {
		const root = createProject(false);
		const requiredPaths = createRequiredExecutorFiles(root);
		const incompleteCalls = successfulCalls([
			...requiredPaths
				.filter((path) => !path.endsWith("shared-standards.md"))
				.map((path) => ["read", path] as [string, string]),
			["read", "spec_lock.md"],
			["write", "svg_output/01_slide.svg"],
		]);

		expect(() => writePptExecutionEvidence(root, incompleteCalls, 1)).toThrow(
			"shared-standards.md",
		);

		const completeCalls = successfulCalls([
			...requiredPaths.map((path) => ["read", path] as [string, string]),
			["read", "spec_lock.md"],
			["write", "svg_output/01_slide.svg"],
		]);
		const evidence = writePptExecutionEvidence(root, completeCalls, 1);
		expect(evidence.requiredReads).toHaveLength(requiredPaths.length);
	});

	it("accepts chunked full coverage for long source material", () => {
		const root = createProject(false);
		mkdirSync(join(root, "sources"), { recursive: true });
		writeFileSync(
			join(root, "sources", "source.md"),
			Array.from({ length: 2_500 }, (_, index) => `line ${index + 1}`).join("\n"),
		);
		const calls = successfulCalls([
			["read", "sources/source.md"],
			["read", "sources/source.md"],
			["read", "spec_lock.md"],
			["write", "svg_output/01_slide.svg"],
		]);
		calls[0].offset = 1;
		calls[0].limit = 2_000;
		calls[1].offset = 2_001;
		calls[1].limit = 500;

		expect(() => writePptExecutionEvidence(root, calls, 1)).not.toThrow();
	});
});

function createProject(withReferences = true) {
	const root = mkdtempSync(join(tmpdir(), "ppt-execution-evidence-"));
	roots.push(root);
	mkdirSync(join(root, "svg_output"), { recursive: true });
	mkdirSync(join(root, ".ppt-master-skill", "templates", "charts"), {
		recursive: true,
	});
	writeFileSync(join(root, "svg_output", "01_slide.svg"), "<svg/>");
	writeFileSync(join(root, "svg_output", "02_slide.svg"), "<svg/>");
	writeFileSync(join(root, ".ppt-master-skill", "templates", "cover.svg"), "<svg/>");
	writeFileSync(
		join(root, ".ppt-master-skill", "templates", "charts", "column_chart.svg"),
		"<svg/>",
	);
	writeFileSync(
		join(root, "spec_lock.md"),
		withReferences
			? [
					"## page_layouts",
					"- P01: cover",
					"## page_charts",
					"- P02: column_chart",
				].join("\n")
			: "## colors\n- bg: #FFFFFF",
	);
	return root;
}

function successfulCalls(entries: Array<[string, string]>): PptAgentToolCall[] {
	return entries.map(([toolName, path], index) => ({
		toolCallId: `call-${index + 1}`,
		toolName,
		path,
		completed: true,
		success: true,
	}));
}

function createRequiredExecutorFiles(root: string) {
	const relativePaths = [
		"design_spec.md",
		"sources/source.md",
		".ppt-master-skill/SKILL.md",
		".ppt-master-skill/workflows/resume-execute.md",
		".ppt-master-skill/references/executor-base.md",
		".ppt-master-skill/references/shared-standards.md",
		".ppt-master-skill/references/image-layout-spec.md",
		".ppt-master-skill/references/svg-image-embedding.md",
	];
	for (const relativePath of relativePaths) {
		const path = join(root, relativePath);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, relativePath);
	}
	return relativePaths;
}

function toolStart(id: string, toolName: string, path: string) {
	return JSON.stringify({
		type: "tool_execution_start",
		toolCallId: id,
		toolName,
		args: { path, ...(toolName === "write" ? { content: "<svg/>" } : {}) },
	});
}

function toolEnd(id: string) {
	return JSON.stringify({
		type: "tool_execution_end",
		toolCallId: id,
		isError: false,
	});
}
