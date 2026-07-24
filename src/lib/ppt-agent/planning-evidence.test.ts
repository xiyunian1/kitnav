import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PptAgentToolCall } from "./execution-evidence";
import {
	assertPptStrategistEvidence,
	getPptStrategistEvidencePath,
	writePptStrategistEvidence,
} from "./planning-evidence";
import { createPptAgentContextBundle } from "./agent-context-bundle";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT Strategist execution evidence", () => {
	it("allows successful directory inspection calls alongside file evidence", () => {
		const { root, requiredReads } = createProject();
		const evidence = writePptStrategistEvidence(
			root,
			successfulCalls([
				["ls", "analysis"],
				["find", "templates"],
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["write", "design_spec.md"],
				["write", "spec_lock.md"],
			]),
		);

		expect(evidence.requiredReads).toHaveLength(requiredReads.length);
	});

	it("still rejects non-exclusive file evidence", () => {
		const { root, requiredReads } = createProject();
		linkSync(
			join(root, "sources", "source.md"),
			join(root, "sources", "source-alias.md"),
		);

		expect(() =>
			writePptStrategistEvidence(
				root,
				successfulCalls([
					...requiredReads.map((path) => ["read", path] as [string, string]),
					["write", "design_spec.md"],
					["write", "spec_lock.md"],
				]),
			),
		).toThrow("不是独占普通文件");
	});

	it("requires official planning references before design contract writes", () => {
		const { root, requiredReads } = createProject();
		const incomplete = successfulCalls([
			...requiredReads
				.filter((path) => !path.endsWith("strategist.md"))
				.map((path) => ["read", path] as [string, string]),
			["write", "design_spec.md"],
			["write", "spec_lock.md"],
		]);

		expect(() => writePptStrategistEvidence(root, incomplete)).toThrow(
			"strategist.md",
		);

		const evidence = writePptStrategistEvidence(
			root,
			successfulCalls([
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["write", "design_spec.md"],
				["write", "spec_lock.md"],
			]),
		);
		expect(evidence.requiredReads).toHaveLength(requiredReads.length);
		expect(() => assertPptStrategistEvidence(root)).not.toThrow();
	});

	it("accepts hash-audited host-injected planning context", () => {
		const { root, requiredReads } = createProject();
		const context = createPptAgentContextBundle({
			projectDir: root,
			phase: "strategist",
			sourcePaths: requiredReads.map((path) => join(root, path)),
		});
		expect(context).not.toBeNull();

		const evidence = writePptStrategistEvidence(
			root,
			successfulCalls([
				["write", "design_spec.md"],
				["write", "spec_lock.md"],
			]),
			true,
			context!.manifest,
		);

		expect(
			evidence.requiredReads.every(
				(item) => item.source === "injected-context",
			),
		).toBe(true);
		expect(() => assertPptStrategistEvidence(root)).not.toThrow();
	});

	it("rejects an incomplete or forged stored evidence file", () => {
		const { root } = createProject();
		writeFileSync(getPptStrategistEvidencePath(root), '{"schema":"wrong"}');
		expect(() => assertPptStrategistEvidence(root)).toThrow("缺少有效");
	});

	it("requires the official selection catalogs before planning", () => {
		const { root, requiredReads } = createProject();
		const calls = successfulCalls([
			...requiredReads
				.filter((path) => !path.endsWith("charts_index.json"))
				.map((path) => ["read", path] as [string, string]),
			["write", "design_spec.md"],
			["write", "spec_lock.md"],
		]);
		expect(() => writePptStrategistEvidence(root, calls)).toThrow(
			"charts_index.json",
		);
	});

	it("requires the icon library reference before locking an icon inventory", () => {
		const { root, requiredReads } = createProject();
		const iconReference = join(
			root,
			".ppt-master-skill",
			"templates",
			"icons",
			"README.md",
		);
		mkdirSync(join(iconReference, ".."), { recursive: true });
		writeFileSync(iconReference, "# Icons\n");
		writeFileSync(
			join(root, "spec_lock.md"),
			"## icons\n- library: tabler-outline\n",
		);

		expect(() =>
			writePptStrategistEvidence(
				root,
				successfulCalls([
					...requiredReads.map(
						(path) => ["read", path] as [string, string],
					),
					["write", "design_spec.md"],
					["write", "spec_lock.md"],
				]),
			),
		).toThrow("templates/icons/README.md");

		const evidence = writePptStrategistEvidence(
			root,
			successfulCalls([
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["read", iconReference],
				["write", "design_spec.md"],
				["write", "spec_lock.md"],
			]),
		);
		expect(evidence.requiredReads).toHaveLength(requiredReads.length + 1);
	});
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-strategist-evidence-"));
	roots.push(root);
	const relativePaths = [
		"sources/source.md",
		".ppt-master-skill/SKILL.md",
		".ppt-master-skill/references/strategist.md",
		".ppt-master-skill/references/modes/_index.md",
		".ppt-master-skill/references/visual-styles/_index.md",
		".ppt-master-skill/templates/charts/charts_index.json",
		".ppt-master-skill/templates/design_spec_reference.md",
		".ppt-master-skill/templates/spec_lock_reference.md",
	];
	for (const relativePath of [
		...relativePaths,
		"design_spec.md",
		"spec_lock.md",
	]) {
		const path = join(root, relativePath);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, relativePath);
	}
	mkdirSync(join(root, "analysis"), { recursive: true });
	mkdirSync(join(root, "templates"), { recursive: true });
	return { root, requiredReads: relativePaths };
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
