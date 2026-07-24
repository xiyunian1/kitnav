import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const CONTEXT_SCHEMA = "ppt_hosted_agent_context.v1";
const DEFAULT_MAX_CONTEXT_BYTES = 2 * 1024 * 1024;
const MIN_MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_MAX_CONTEXT_BYTES = 16 * 1024 * 1024;

export type PptAgentContextPhase = "strategist" | "executor";

export interface PptAgentContextSource {
	path: string;
	sha256: string;
	bytes: number;
}

export interface PptAgentContextManifest {
	schema: typeof CONTEXT_SCHEMA;
	phase: PptAgentContextPhase;
	bundlePath: string;
	bundleSha256: string;
	sources: PptAgentContextSource[];
	createdAt: string;
}

export interface PptAgentContextBundle {
	content: string;
	manifest: PptAgentContextManifest;
}

export function isPptAgentContextBundleEnabled(
	configured = process.env.PPT_AGENT_INLINE_CONTEXT,
) {
	if (configured === undefined || configured.trim() === "") return true;
	return !["0", "false", "no", "off"].includes(configured.trim().toLowerCase());
}

export function resolvePptAgentContextMaxBytes(
	configured = process.env.PPT_AGENT_INLINE_CONTEXT_MAX_BYTES,
) {
	const parsed = Number(configured);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_MAX_CONTEXT_BYTES;
	}
	return Math.max(
		MIN_MAX_CONTEXT_BYTES,
		Math.min(MAX_MAX_CONTEXT_BYTES, Math.floor(parsed)),
	);
}

export function createPptAgentContextBundle(input: {
	projectDir: string;
	phase: PptAgentContextPhase;
	sourcePaths: string[];
	maxBytes?: number;
}): PptAgentContextBundle | null {
	const bundlePath = getPptAgentContextBundlePath(
		input.projectDir,
		input.phase,
	);
	if (!isPptAgentContextBundleEnabled()) {
		rmSync(bundlePath, { force: true });
		return null;
	}
	const maxBytes = input.maxBytes ?? resolvePptAgentContextMaxBytes();
	const sourceRecords = uniquePaths(input.projectDir, input.sourcePaths).map((path) =>
		readContextSource(input.projectDir, path),
	);
	const totalBytes = sourceRecords.reduce(
		(total, source) => total + source.bytes,
		0,
	);
	if (totalBytes > maxBytes) {
		rmSync(bundlePath, { force: true });
		return null;
	}

	const content = [
		"# Hosted PPT Agent Context Bundle",
		"",
		`- schema: ${CONTEXT_SCHEMA}`,
		`- phase: ${input.phase}`,
		`- source_count: ${sourceRecords.length}`,
		`- source_bytes: ${totalBytes}`,
		"",
		"下列内容由服务器从当前项目文件逐字读取并按 SHA-256 审计。路径标题和哈希属于宿主元数据；各 source 正文保持原样。",
		"",
		...sourceRecords.flatMap((source) => [
			`## BEGIN SOURCE: ${source.path}`,
			`sha256: ${source.sha256}`,
			`bytes: ${source.bytes}`,
			"",
			source.content,
			"",
			`## END SOURCE: ${source.path}`,
			"",
		]),
	].join("\n");
	mkdirSync(join(input.projectDir, "analysis"), { recursive: true });
	const temporaryPath = `${bundlePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, content, "utf-8");
	renameSync(temporaryPath, bundlePath);

	return {
		content,
		manifest: {
			schema: CONTEXT_SCHEMA,
			phase: input.phase,
			bundlePath: normalizeContextPath(input.projectDir, bundlePath),
			bundleSha256: sha256(Buffer.from(content)),
			sources: sourceRecords.map(({ path, sha256: hash, bytes }) => ({
				path,
				sha256: hash,
				bytes,
			})),
			createdAt: new Date().toISOString(),
		},
	};
}

export function getPptAgentContextBundlePath(
	projectDir: string,
	phase: PptAgentContextPhase,
) {
	return join(projectDir, "analysis", `hosted_${phase}_context.md`);
}

export function assertPptAgentContextManifest(
	projectDir: string,
	value: unknown,
	expectedPhase?: PptAgentContextPhase,
): PptAgentContextManifest {
	if (!isPptAgentContextManifest(value)) {
		throw new Error("PPT Agent 注入上下文证据格式无效。");
	}
	if (expectedPhase && value.phase !== expectedPhase) {
		throw new Error(
			`PPT Agent 注入上下文阶段不正确：${value.phase}/${expectedPhase}。`,
		);
	}
	const bundlePath = resolveContextPath(projectDir, value.bundlePath);
	const bundle = readFileSync(bundlePath);
	if (sha256(bundle) !== value.bundleSha256) {
		throw new Error("PPT Agent 注入上下文文件已发生变化。");
	}
	const seen = new Set<string>();
	for (const source of value.sources) {
		if (seen.has(source.path)) {
			throw new Error(`PPT Agent 注入上下文包含重复来源：${source.path}。`);
		}
		seen.add(source.path);
		const path = resolveContextPath(projectDir, source.path);
		const content = readFileSync(path);
		if (content.length !== source.bytes || sha256(content) !== source.sha256) {
			throw new Error(`PPT Agent 注入上下文来源已发生变化：${source.path}。`);
		}
	}
	return value;
}

export function isPptAgentContextManifest(
	value: unknown,
): value is PptAgentContextManifest {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<PptAgentContextManifest>;
	return (
		item.schema === CONTEXT_SCHEMA &&
		(item.phase === "strategist" || item.phase === "executor") &&
		typeof item.bundlePath === "string" &&
		item.bundlePath.length > 0 &&
		typeof item.bundleSha256 === "string" &&
		/^[a-f0-9]{64}$/.test(item.bundleSha256) &&
		Array.isArray(item.sources) &&
		item.sources.length > 0 &&
		item.sources.every(isPptAgentContextSource) &&
		typeof item.createdAt === "string" &&
		Number.isFinite(Date.parse(item.createdAt))
	);
}

export function findPptAgentContextSource(
	projectDir: string,
	manifest: PptAgentContextManifest,
	path: string,
) {
	const normalizedPath = normalizeContextPath(projectDir, path);
	return manifest.sources.find((source) => source.path === normalizedPath) || null;
}

function readContextSource(projectDir: string, path: string) {
	const normalizedPath = normalizeContextPath(projectDir, path);
	const resolvedPath = resolveContextPath(projectDir, normalizedPath);
	const content = readFileSync(resolvedPath);
	return {
		path: normalizedPath,
		sha256: sha256(content),
		bytes: content.length,
		content: content.toString("utf-8"),
	};
}

function normalizeContextPath(projectDir: string, path: string) {
	const root = realpathSync(resolve(projectDir));
	const candidate = isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
	if (!existsSync(candidate)) {
		throw new Error(`PPT Agent 注入上下文来源不存在：${path}。`);
	}
	const stats = lstatSync(candidate);
	if (!stats.isFile()) {
		throw new Error(`PPT Agent 注入上下文来源不是普通文件：${path}。`);
	}
	const canonical = realpathSync(candidate);
	const normalized = relative(root, canonical).replaceAll(sep, "/");
	if (
		!normalized ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		isAbsolute(normalized)
	) {
		throw new Error(`PPT Agent 注入上下文来源越出项目目录：${path}。`);
	}
	return normalized;
}

function resolveContextPath(projectDir: string, path: string) {
	const root = realpathSync(resolve(projectDir));
	const candidate = resolve(root, path);
	const normalized = relative(root, candidate).replaceAll(sep, "/");
	if (
		!normalized ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		isAbsolute(normalized)
	) {
		throw new Error(`PPT Agent 注入上下文路径越出项目目录：${path}。`);
	}
	if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
		throw new Error(`PPT Agent 注入上下文文件不存在：${path}。`);
	}
	const canonical = realpathSync(candidate);
	const canonicalRelative = relative(root, canonical).replaceAll(sep, "/");
	if (
		!canonicalRelative ||
		canonicalRelative === ".." ||
		canonicalRelative.startsWith("../") ||
		isAbsolute(canonicalRelative)
	) {
		throw new Error(`PPT Agent 注入上下文路径越出项目目录：${path}。`);
	}
	return canonical;
}

function uniquePaths(projectDir: string, paths: string[]) {
	return [
		...new Set(
			paths.map((path) =>
				isAbsolute(path) ? resolve(path) : resolve(projectDir, path),
			),
		),
	];
}

function isPptAgentContextSource(value: unknown): value is PptAgentContextSource {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<PptAgentContextSource>;
	return (
		typeof item.path === "string" &&
		item.path.length > 0 &&
		typeof item.sha256 === "string" &&
		/^[a-f0-9]{64}$/.test(item.sha256) &&
		typeof item.bytes === "number" &&
		Number.isInteger(item.bytes) &&
		item.bytes >= 0
	);
}

function sha256(content: Buffer) {
	return createHash("sha256").update(content).digest("hex");
}
