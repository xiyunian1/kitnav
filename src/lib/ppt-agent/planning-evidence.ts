import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PptAgentToolCall } from "./execution-evidence";
import {
	assertPptAgentContextManifest,
	findPptAgentContextSource,
	type PptAgentContextManifest,
} from "./agent-context-bundle";

const EVIDENCE_SCHEMA = "ppt_hosted_strategist_evidence.v1";

export function getPptStrategistEvidencePath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_strategist_evidence.json");
}

export function writePptStrategistEvidence(
	projectDir: string,
	toolCalls: PptAgentToolCall[],
	toolCaptureComplete = true,
	contextManifest?: PptAgentContextManifest,
) {
	if (!toolCaptureComplete) {
		throw new Error("PPT Strategist 工具事件记录不完整，无法验证官方规划顺序。");
	}
	const injectedContext = contextManifest
		? assertPptAgentContextManifest(projectDir, contextManifest, "strategist")
		: undefined;
	const ordered = toolCalls
		.filter((call) => call.completed && call.success)
		.map((call, index) => ({
			...call,
			sequence: call.startEventIndex ?? index * 2 + 1,
			completedSequence: call.endEventIndex ?? index * 2 + 2,
			normalizedPath: call.path && isEvidenceFileTool(call.toolName)
				? normalizeToolPath(projectDir, call.path)
				: "",
		}));
	const contractPaths = ["design_spec.md", "spec_lock.md"];
	const contractMutations = ordered.filter(
		(call) =>
			(call.toolName === "write" || call.toolName === "edit") &&
			contractPaths.includes(call.normalizedPath),
	);
	for (const path of contractPaths) {
		if (!contractMutations.some((call) => call.normalizedPath === path)) {
			throw new Error(`PPT Strategist 没有通过受审计工具写入 ${path}。`);
		}
	}
	const firstContractMutation = Math.min(
		...contractMutations.map((call) => call.sequence),
	);
	const reads = ordered.filter(
		(call) => call.toolName === "read" && Boolean(call.normalizedPath),
	);
	const requiredReads = collectRequiredStrategistReads(projectDir).map((path) =>
		findRequiredReadCoverage(
			projectDir,
			reads,
			firstContractMutation,
			path,
			injectedContext,
		),
	);
	const evidence = {
		schema: EVIDENCE_SCHEMA,
		verifiedAt: new Date().toISOString(),
		injectedContext,
		requiredReads,
		contractWrites: contractPaths.map((path) => ({
			path,
			sequences: contractMutations
				.filter((call) => call.normalizedPath === path)
				.map((call) => call.sequence),
		})),
	};
	const path = getPptStrategistEvidencePath(projectDir);
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, path);
	return evidence;
}

export function assertPptStrategistEvidence(projectDir: string) {
	const path = getPptStrategistEvidencePath(projectDir);
	let evidence: unknown;
	try {
		evidence = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		throw new Error("PPT 规划恢复缺少有效的 Strategist 执行证据。");
	}
	if (
		!evidence ||
		typeof evidence !== "object" ||
		(evidence as { schema?: unknown }).schema !== EVIDENCE_SCHEMA ||
		!Array.isArray((evidence as { requiredReads?: unknown }).requiredReads) ||
		!Array.isArray((evidence as { contractWrites?: unknown }).contractWrites)
	) {
		throw new Error("PPT 规划恢复缺少有效的 Strategist 执行证据。");
	}
	const injectedContext = (evidence as { injectedContext?: unknown })
		.injectedContext;
	if (injectedContext !== undefined) {
		assertPptAgentContextManifest(projectDir, injectedContext, "strategist");
	}
	return evidence;
}

function collectRequiredStrategistReads(projectDir: string) {
	const required = [
		join(projectDir, "sources", "source.md"),
		join(projectDir, "analysis", "source_index.json"),
		join(projectDir, "analysis", "source_profile.json"),
		join(projectDir, "analysis", "image_analysis.csv"),
	].filter(existsSync);
	const skillDir = join(projectDir, ".ppt-master-skill");
	const skillFile = join(skillDir, "SKILL.md");
	if (existsSync(skillFile)) {
		for (const relativePath of [
			"SKILL.md",
			join("references", "strategist.md"),
			join("references", "modes", "_index.md"),
			join("references", "visual-styles", "_index.md"),
			join("templates", "charts", "charts_index.json"),
			join("templates", "design_spec_reference.md"),
			join("templates", "spec_lock_reference.md"),
		]) {
			const path = join(skillDir, relativePath);
			if (!existsSync(path)) {
				throw new Error(`PPT Strategist 缺少官方必读文件：${relativePath}。`);
			}
			required.push(path);
		}
		for (const path of collectLockedStrategistReferences(projectDir, skillDir)) {
			required.push(path);
		}
	}
	for (const path of findTemplateDesignSpecs(join(projectDir, "templates"))) {
		required.push(path);
	}
	return [...new Set(required)];
}

function collectLockedStrategistReferences(projectDir: string, skillDir: string) {
	const specLockPath = join(projectDir, "spec_lock.md");
	if (!existsSync(specLockPath)) return [];
	const specLock = readFileSync(specLockPath, "utf-8");
	const required: string[] = [];
	for (const [family, value] of [
		["modes", readLockValue(specLock, "mode")],
		["visual-styles", readLockValue(specLock, "visual_style")],
	] as const) {
		if (!value || value === "custom") continue;
		const path = join(skillDir, "references", family, `${value}.md`);
		if (!existsSync(path)) {
			throw new Error(`PPT Strategist 缺少锁定参考文件：${family}/${value}.md。`);
		}
		required.push(path);
	}
	if (/^##\s+icons\s*$/im.test(specLock)) {
		required.push(join(skillDir, "templates", "icons", "README.md"));
	}
	if (
		/^##\s+images\s*$/im.test(specLock) ||
		/^\s*-\s+image_(?:rendering|palette):/im.test(specLock)
	) {
		required.push(
			join(skillDir, "references", "image-renderings", "_index.md"),
			join(skillDir, "references", "image-palettes", "_index.md"),
			join(skillDir, "references", "image-layout-patterns.md"),
		);
	}
	for (const path of required) {
		if (!existsSync(path)) {
			throw new Error(`PPT Strategist 缺少官方必读文件：${relative(skillDir, path)}。`);
		}
	}
	return required;
}

function readLockValue(content: string, key: string) {
	return content.match(
		new RegExp(`^\\s*-\\s+${key}:\\s*([A-Za-z0-9_.-]+)\\s*$`, "im"),
	)?.[1];
}

function findTemplateDesignSpecs(directory: string) {
	if (!existsSync(directory)) return [];
	const paths: string[] = [];
	const visit = (currentDirectory: string) => {
		for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
			const path = join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				visit(path);
			} else if (entry.isFile() && entry.name === "design_spec.md") {
				paths.push(path);
			} else if (!entry.isFile()) {
				throw new Error(`PPT 模板包含不受支持的目录条目：${entry.name}。`);
			}
		}
	};
	visit(directory);
	return paths;
}

function findRequiredReadCoverage(
	projectDir: string,
	reads: Array<{
		sequence: number;
		completedSequence: number;
		normalizedPath: string;
		offset?: number;
		limit?: number;
	}>,
	beforeSequence: number,
	path: string,
	contextManifest?: PptAgentContextManifest,
) {
	const normalizedPath = normalizeToolPath(projectDir, path);
	const injectedSource = contextManifest
		? findPptAgentContextSource(projectDir, contextManifest, path)
		: null;
	if (injectedSource) {
		return {
			path: normalizedPath,
			sha256: injectedSource.sha256,
			sequences: [],
			source: "injected-context" as const,
			bundleSha256: contextManifest!.bundleSha256,
		};
	}
	const candidates = reads.filter(
		(read) =>
			read.completedSequence < beforeSequence &&
			read.normalizedPath === normalizedPath,
	);
	if (!hasCompleteTextReadCoverage(path, candidates)) {
		throw new Error(
			`PPT Strategist 在写设计契约前未完整读取必需文件：${normalizedPath}。`,
		);
	}
	return {
		path: normalizedPath,
		sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
		sequences: candidates.map((read) => read.sequence),
		source: "tool-read" as const,
	};
}

function hasCompleteTextReadCoverage(
	path: string,
	reads: Array<{ offset?: number; limit?: number }>,
) {
	const lineCount = readFileSync(path, "utf-8").split("\n").length;
	const intervals = reads
		.map((read) => {
			const start = Math.max(1, Math.floor(read.offset ?? 1));
			const limit = Math.min(
				2_000,
				Math.max(1, Math.floor(read.limit ?? 2_000)),
			);
			return [start, Math.min(lineCount, start + limit - 1)] as const;
		})
		.sort((left, right) => left[0] - right[0]);
	let coveredThrough = 0;
	for (const [start, end] of intervals) {
		if (start > coveredThrough + 1) return false;
		coveredThrough = Math.max(coveredThrough, end);
		if (coveredThrough >= lineCount) return true;
	}
	return coveredThrough >= lineCount;
}

function normalizeToolPath(projectDir: string, inputPath: string) {
	const root = resolve(projectDir);
	const candidate = isAbsolute(inputPath)
		? resolve(inputPath)
		: resolve(projectDir, inputPath);
	const canonical = existsSync(candidate) ? resolveExclusivePath(candidate) : candidate;
	const normalized = relative(root, canonical).replaceAll(sep, "/");
	if (!normalized || normalized === ".") return "";
	if (normalized === ".." || normalized.startsWith("../")) {
		return canonical.replaceAll(sep, "/");
	}
	return normalized;
}

function isEvidenceFileTool(toolName: string) {
	return toolName === "read" || toolName === "write" || toolName === "edit";
}

function resolveExclusivePath(path: string) {
	const stats = lstatSync(path);
	if (!stats.isFile() || stats.nlink !== 1) {
		throw new Error(`PPT 证据文件不是独占普通文件：${path}。`);
	}
	return resolve(path);
}
