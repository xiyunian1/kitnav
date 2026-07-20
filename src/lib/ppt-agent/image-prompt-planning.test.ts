import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PptAgentToolCall } from "./execution-evidence";
import {
	assertPptImagePromptContract,
	assertPptImagePromptEvidence,
	writePptImagePromptEvidence,
} from "./image-prompt-planning";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT hosted image prompt planning", () => {
	it("allows successful directory inspection calls alongside file evidence", () => {
		const { root, skillDir, requiredReads } = createProject();
		const evidence = writePptImagePromptEvidence(
			root,
			skillDir,
			successfulCalls([
				["ls", "analysis"],
				["find", "images"],
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["write", "images/image_prompts.json"],
			]),
			4,
		);

		expect(evidence.requiredReads).toHaveLength(requiredReads.length);
	});

	it("still rejects non-exclusive file evidence", () => {
		const { root, skillDir, requiredReads } = createProject();
		linkSync(join(root, "design_spec.md"), join(root, "design-spec-alias.md"));

		expect(() =>
			writePptImagePromptEvidence(
				root,
				skillDir,
				successfulCalls([
					...requiredReads.map((path) => ["read", path] as [string, string]),
					["write", "images/image_prompts.json"],
				]),
				4,
			),
		).toThrow("不是独占普通文件");
	});

	it("requires official dimension reads before accepting the manifest", () => {
		const { root, skillDir, requiredReads } = createProject();
		const calls = successfulCalls([
			...requiredReads.map((path) => ["read", path] as [string, string]),
			["write", "images/image_prompts.json"],
		]);
		const evidence = writePptImagePromptEvidence(
			root,
			skillDir,
			calls,
			4,
		);
		expect(evidence.requiredReads).toHaveLength(requiredReads.length);
		expect(() =>
			assertPptImagePromptEvidence(root, 4, skillDir),
		).not.toThrow();
	});

	it("rejects a skipped image type reference", () => {
		const { root, skillDir, requiredReads } = createProject();
		const calls = successfulCalls([
			...requiredReads
				.filter((path) => !path.endsWith("framework.md"))
				.map((path) => ["read", path] as [string, string]),
			["write", "images/image_prompts.json"],
		]);
		expect(() =>
			writePptImagePromptEvidence(root, skillDir, calls, 4),
		).toThrow("framework.md");
	});

	it("rejects shell-based manifest assembly", () => {
		const { root, skillDir, requiredReads } = createProject();
		const calls = successfulCalls([
			...requiredReads.map((path) => ["read", path] as [string, string]),
			["bash", "analysis"],
			["write", "images/image_prompts.json"],
		]);
		expect(() =>
			writePptImagePromptEvidence(root, skillDir, calls, 4),
		).toThrow("不得调用 bash");
	});

	it("rejects prompts that omit the locked palette", () => {
		const { root, skillDir } = createProject();
		const manifestPath = join(root, "images", "image_prompts.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		manifest.items[0].prompt = manifest.items[0].prompt.replaceAll("#F5F7FA", "");
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		expect(() => assertPptImagePromptContract(root, 4, skillDir)).toThrow(
			"#F5F7FA",
		);
	});

	it("keeps evidence valid after generation updates runtime fields", () => {
		const { root, skillDir, requiredReads } = createProject();
		writePptImagePromptEvidence(
			root,
			skillDir,
			successfulCalls([
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["write", "images/image_prompts.json"],
			]),
			4,
		);
		const manifestPath = join(root, "images", "image_prompts.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		manifest.items[0].status = "Generated";
		manifest.items[0].generated_at = "2026-07-18T00:00:00.000Z";
		manifest.items[0].model = "image-model";
		manifest.items[0].width = 1536;
		manifest.items[0].height = 1024;
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		const designSpecPath = join(root, "design_spec.md");
		writeFileSync(
			designSpecPath,
			readFileSync(designSpecPath, "utf-8").replace("Pending", "Generated"),
		);
		expect(() => assertPptImagePromptEvidence(root, 4, skillDir)).not.toThrow();
	});

	it("invalidates evidence when an assembled prompt changes", () => {
		const { root, skillDir, requiredReads } = createProject();
		writePptImagePromptEvidence(
			root,
			skillDir,
			successfulCalls([
				...requiredReads.map((path) => ["read", path] as [string, string]),
				["write", "images/image_prompts.json"],
			]),
			4,
		);
		const manifestPath = join(root, "images", "image_prompts.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
		manifest.items[0].prompt += " Added unreviewed composition instruction.";
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		expect(() => assertPptImagePromptEvidence(root, 4, skillDir)).toThrow(
			"当前清单不匹配",
		);
	});
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-image-prompt-planning-"));
	roots.push(root);
	const skillDir = join(root, ".ppt-master-skill");
	const skillReferences = [
		"SKILL.md",
		"references/image-base.md",
		"references/image-generator.md",
		"references/image-renderings/_index.md",
		"references/image-renderings/vector-illustration.md",
		"references/image-palettes/_index.md",
		"references/image-palettes/cool-corporate.md",
		"references/image-type-templates/_index.md",
		"references/image-type-templates/framework.md",
	];
	for (const relativePath of skillReferences) {
		const path = join(skillDir, relativePath);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, `${relativePath}\n`);
	}
	mkdirSync(join(root, "images"), { recursive: true });
	writeFileSync(
		join(root, "design_spec.md"),
		[
			"## VIII. Image Resource List (if needed)",
			"| Filename | Purpose | Acquire Via | Status |",
			"| --- | --- | --- | --- |",
			"| process.png | 流程配图 | ai | Pending |",
			"## IX. Content Outline",
		].join("\n"),
	);
	writeFileSync(
		join(root, "spec_lock.md"),
		[
			"## colors",
			"- bg: #F5F7FA",
			"- primary: #173F5F",
			"- accent: #F2B134",
			"- image_rendering: vector-illustration",
			"- image_palette: cool-corporate",
		].join("\n"),
	);
	const prompt = [
		"Clean flat vector illustration with crisp geometry and a restrained professional finish.",
		"Use #F5F7FA as the broad breathing field, #173F5F for the dominant process structure, and #F2B134 only for one emphasis point.",
		"Compose a local region block showing a four-stage framework with clearly separated nodes, balanced internal spacing, and a single visual reading direction.",
		"The image sits inside a presentation content container and must remain legible at medium size.",
		"NO visible text, letters, numbers, labels, logos, signatures, or watermarks; color codes are guidance only.",
	].join(" ");
	writeFileSync(
		join(root, "images", "image_prompts.json"),
		`${JSON.stringify(
			{
				deck_rendering: "vector-illustration",
				deck_palette: "cool-corporate",
				color_scheme: {
					secondary: "#F5F7FA",
					primary: "#173F5F",
					accent: "#F2B134",
				},
				items: [
					{
						filename: "process.png",
						prompt,
						aspect_ratio: "16:9",
						status: "Pending",
						page_role: "local",
						text_policy: "none",
						type: "framework",
					},
				],
			},
			null,
			2,
		)}\n`,
	);
	mkdirSync(join(root, "analysis"), { recursive: true });
	return {
		root,
		skillDir,
		requiredReads: [
			"design_spec.md",
			"spec_lock.md",
			...skillReferences.map((relativePath) => join(skillDir, relativePath)),
		],
	};
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
