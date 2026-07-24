import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertPptAgentContextManifest,
	createPptAgentContextBundle,
	findPptAgentContextSource,
	getPptAgentContextBundlePath,
	isPptAgentContextBundleEnabled,
	resolvePptAgentContextMaxBytes,
} from "./agent-context-bundle";

const roots: string[] = [];

afterEach(() => {
	delete process.env.PPT_AGENT_INLINE_CONTEXT;
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("PPT Agent injected context bundle", () => {
	it("stores exact source hashes and validates the persisted bundle", () => {
		const root = createProject();
		const sourcePath = join(root, "sources", "source.md");
		const rulePath = join(root, ".ppt-master-skill", "SKILL.md");
		const bundle = createPptAgentContextBundle({
			projectDir: root,
			phase: "executor",
			sourcePaths: [rulePath, sourcePath, sourcePath],
		});

		expect(bundle).not.toBeNull();
		expect(bundle!.manifest.sources).toHaveLength(2);
		expect(bundle!.content).toContain("完整资料");
		expect(
			assertPptAgentContextManifest(root, bundle!.manifest, "executor"),
		).toEqual(bundle!.manifest);
		expect(
			findPptAgentContextSource(root, bundle!.manifest, sourcePath)?.path,
		).toBe("sources/source.md");
	});

	it("rejects a bundle after one of its source files changes", () => {
		const root = createProject();
		const sourcePath = join(root, "sources", "source.md");
		const bundle = createPptAgentContextBundle({
			projectDir: root,
			phase: "strategist",
			sourcePaths: [sourcePath],
		});
		expect(bundle).not.toBeNull();

		writeFileSync(sourcePath, "changed");
		expect(() =>
			assertPptAgentContextManifest(root, bundle!.manifest, "strategist"),
		).toThrow("来源已发生变化");
	});

	it("falls back when disabled or when sources exceed the limit", () => {
		const root = createProject();
		const sourcePath = join(root, "sources", "source.md");
		expect(
			createPptAgentContextBundle({
				projectDir: root,
				phase: "executor",
				sourcePaths: [sourcePath],
			}),
		).not.toBeNull();
		expect(existsSync(getPptAgentContextBundlePath(root, "executor"))).toBe(
			true,
		);
		process.env.PPT_AGENT_INLINE_CONTEXT = "false";
		expect(
			createPptAgentContextBundle({
				projectDir: root,
				phase: "executor",
				sourcePaths: [sourcePath],
			}),
		).toBeNull();
		expect(existsSync(getPptAgentContextBundlePath(root, "executor"))).toBe(
			false,
		);

		process.env.PPT_AGENT_INLINE_CONTEXT = "true";
		expect(
			createPptAgentContextBundle({
				projectDir: root,
				phase: "executor",
				sourcePaths: [sourcePath],
				maxBytes: 1,
			}),
		).toBeNull();
	});

	it("normalizes feature flags and configured size limits", () => {
		expect(isPptAgentContextBundleEnabled(undefined)).toBe(true);
		expect(isPptAgentContextBundleEnabled("off")).toBe(false);
		expect(isPptAgentContextBundleEnabled("true")).toBe(true);
		expect(resolvePptAgentContextMaxBytes("1")).toBe(64 * 1024);
		expect(resolvePptAgentContextMaxBytes("999999999")).toBe(16 * 1024 * 1024);
	});

	it("rejects context sources outside the project", () => {
		const root = createProject();
		const outside = join(tmpdir(), `ppt-context-outside-${Date.now()}.md`);
		writeFileSync(outside, "outside");
		try {
			expect(() =>
				createPptAgentContextBundle({
					projectDir: root,
					phase: "executor",
					sourcePaths: [outside],
				}),
			).toThrow("越出项目目录");
		} finally {
			rmSync(outside, { force: true });
		}
	});
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-agent-context-"));
	roots.push(root);
	mkdirSync(join(root, "sources"), { recursive: true });
	mkdirSync(join(root, ".ppt-master-skill"), { recursive: true });
	writeFileSync(join(root, "sources", "source.md"), "完整资料");
	writeFileSync(join(root, ".ppt-master-skill", "SKILL.md"), "完整规则");
	return root;
}
