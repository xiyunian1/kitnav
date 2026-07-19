import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PptAgentToolCall } from "./execution-evidence";
import {
	readPptImageManifest,
	type PptImageManifestItem,
} from "./image-generation";

const EVIDENCE_SCHEMA = "ppt_hosted_image_prompt_evidence.v1";

export function getPptImagePromptEvidencePath(projectDir: string) {
	return join(projectDir, "analysis", "hosted_image_prompt_evidence.json");
}

export function hasPptImagePromptEvidence(projectDir: string) {
	return existsSync(getPptImagePromptEvidencePath(projectDir));
}

export function assertPptImagePromptContract(
	projectDir: string,
	maxImages: number,
	skillDir: string,
) {
	const { manifest, manifestPath } = readPptImageManifest(projectDir, maxImages);
	const expectedFilenames = readAiImageResourceFilenames(projectDir);
	const actualFilenames = manifest.items.map((item) => item.filename.toLowerCase());
	if (
		expectedFilenames.length !== actualFilenames.length ||
		expectedFilenames.some((filename) => !actualFilenames.includes(filename))
	) {
		throw new Error(
			"PPT 图片清单必须与 design_spec.md 中 Acquire Via: ai 的资源逐项一致。",
		);
	}

	const specLock = readFileSync(join(projectDir, "spec_lock.md"), "utf-8");
	const rendering = requireLockValue(specLock, "image_rendering");
	const palette = requireLockValue(specLock, "image_palette");
	const lockedColors = readPromptColors(specLock);
	const colorValues = readPromptColorValues(lockedColors);
	if (colorValues.length < 3) {
		throw new Error("PPT 图片提示词规划至少需要三个已锁定的设计色值。");
	}
	assertManifestDeckContract(manifest, rendering, palette, lockedColors);
	const requiredReferencePaths = collectBaseReferencePaths(
		skillDir,
		rendering,
		palette,
		specLock,
	);

	for (const [index, item] of manifest.items.entries()) {
		assertManifestItemContract(item, index, colorValues, skillDir);
		if (item.type) {
			requiredReferencePaths.push(
				join(skillDir, "references", "image-type-templates", `${item.type}.md`),
			);
		}
	}
	for (const path of requiredReferencePaths) {
		if (!existsSync(path)) {
			throw new Error(
				`PPT 图片提示词规划引用了不存在的官方文件：${relative(skillDir, path)}。`,
			);
		}
	}
	return {
		manifest,
		manifestPath,
		requiredReferencePaths: unique(requiredReferencePaths),
	};
}

export function writePptImagePromptEvidence(
	projectDir: string,
	skillDir: string,
	toolCalls: PptAgentToolCall[],
	maxImages: number,
	toolCaptureComplete = true,
) {
	if (!toolCaptureComplete) {
		throw new Error("PPT 图片提示词工具事件记录不完整，无法验证官方组装流程。");
	}
	const contract = assertPptImagePromptContract(projectDir, maxImages, skillDir);
	const ordered = toolCalls
		.filter((call) => call.completed && call.success)
		.map((call, index) => ({
			...call,
			sequence: call.startEventIndex ?? index * 2 + 1,
			completedSequence: call.endEventIndex ?? index * 2 + 2,
				normalizedPath: call.path
					? normalizeToolPath(projectDir, call.path)
					: "",
			}));
	if (ordered.some((call) => call.toolName === "bash")) {
		throw new Error("PPT Image_Generator 图片提示词阶段不得调用 bash。");
	}
	const mutation = ordered.findLast(
		(call) =>
			(call.toolName === "write" || call.toolName === "edit") &&
			call.normalizedPath === "images/image_prompts.json",
	);
	if (!mutation) {
		throw new Error("PPT Image_Generator 没有通过受审计工具写入图片清单。");
	}
	const reads = ordered.filter(
		(call) => call.toolName === "read" && Boolean(call.normalizedPath),
	);
	const requiredPaths = unique([
		join(projectDir, "design_spec.md"),
		join(projectDir, "spec_lock.md"),
		...contract.requiredReferencePaths,
	]);
	const requiredReads = requiredPaths.map((path) =>
		findRequiredReadCoverage(projectDir, reads, mutation.sequence, path),
	);
	const evidence = {
		schema: EVIDENCE_SCHEMA,
		verifiedAt: new Date().toISOString(),
		manifestContractSha256: hashManifestContract(contract.manifest),
		planningInputsSha256: hashPlanningInputs(projectDir),
		requiredReads,
	};
	const evidencePath = getPptImagePromptEvidencePath(projectDir);
	mkdirSync(join(projectDir, "analysis"), { recursive: true });
	const temporaryPath = `${evidencePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, evidencePath);
	return evidence;
}

export function assertPptImagePromptEvidence(
	projectDir: string,
	maxImages: number,
	skillDir: string,
) {
	const contract = assertPptImagePromptContract(projectDir, maxImages, skillDir);
	let evidence: unknown;
	try {
		evidence = JSON.parse(
			readFileSync(getPptImagePromptEvidencePath(projectDir), "utf-8"),
		);
	} catch {
		throw new Error("PPT 图片提示词缺少有效的宿主执行证据。");
	}
	if (!evidence || typeof evidence !== "object") {
		throw new Error("PPT 图片提示词缺少有效的宿主执行证据。");
	}
	const value = evidence as {
		schema?: unknown;
		manifestContractSha256?: unknown;
		planningInputsSha256?: unknown;
		requiredReads?: unknown;
	};
	if (
		value.schema !== EVIDENCE_SCHEMA ||
		value.manifestContractSha256 !== hashManifestContract(contract.manifest) ||
		value.planningInputsSha256 !== hashPlanningInputs(projectDir) ||
		!Array.isArray(value.requiredReads)
	) {
		throw new Error("PPT 图片提示词宿主执行证据与当前清单不匹配。");
	}
	const expectedPaths = unique([
		join(projectDir, "design_spec.md"),
		join(projectDir, "spec_lock.md"),
		...contract.requiredReferencePaths,
	]).map((path) => normalizeToolPath(projectDir, path));
	const recorded = new Map(
		(value.requiredReads as Array<Record<string, unknown>>).map((item) => [
			String(item.path || ""),
			String(item.sha256 || ""),
		]),
	);
	for (const path of expectedPaths) {
		const absolutePath = isAbsolute(path) ? path : join(projectDir, path);
		if (path === "design_spec.md" || path === "spec_lock.md") continue;
		if (recorded.get(path) !== sha256(absolutePath)) {
			throw new Error(`PPT 图片提示词宿主执行证据已失效：${path}。`);
		}
	}
	return contract;
}

function assertManifestItemContract(
	item: PptImageManifestItem,
	index: number,
	colors: string[],
	skillDir: string,
) {
	const label = `图片清单第 ${index + 1} 项`;
	if (item.page_role !== "local" && item.page_role !== "hero_page") {
		throw new Error(`${label}缺少有效 page_role。`);
	}
	if (item.text_policy !== "none" && item.text_policy !== "embedded") {
		throw new Error(`${label}缺少有效 text_policy。`);
	}
	const isSheet = Boolean(item.slice_grid || item.slice_names);
	if (!isSheet && item.page_role === "local") {
		if (!item.type || !/^[a-z0-9-]+$/.test(item.type)) {
			throw new Error(`${label}的 local 图片缺少有效 type。`);
		}
		const typePath = join(
			skillDir,
			"references",
			"image-type-templates",
			`${item.type}.md`,
		);
		if (!existsSync(typePath)) {
			throw new Error(`${label}使用了未知的官方 type：${item.type}。`);
		}
	}
	if (item.page_role === "hero_page" && item.type) {
		throw new Error(`${label}的 hero_page 必须省略 type。`);
	}
	if (item.prompt.trim().length < 240) {
		throw new Error(`${label}提示词过短，未完成官方多维组装。`);
	}
	for (const color of colors.slice(0, 3)) {
		if (!item.prompt.toLowerCase().includes(color.toLowerCase())) {
			throw new Error(`${label}提示词未应用锁定色值 ${color}。`);
		}
	}
	if (
		item.text_policy === "none" &&
		!/(?:\bno\s+(?:visible\s+)?text\b|without\s+text|不得[^。；\n]{0,20}(?:文字|文本|字母|数字)|无(?:可见)?文字)/i.test(
			item.prompt,
		)
	) {
		throw new Error(`${label}没有落实无文字策略。`);
	}
	if (
		item.page_role === "hero_page" &&
		!/(?:hero|full[- ]bleed|主视觉|全幅|满版|背景画布)/i.test(item.prompt)
	) {
		throw new Error(`${label}没有落实 hero_page 构图。`);
	}
	if (
		item.page_role === "local" &&
		!/(?:local|region(?:al)?\s+block|content\s+block|局部|区域(?:块)?|内容块|容器)/i.test(
			item.prompt,
		)
	) {
		throw new Error(`${label}没有落实 local 区域构图。`);
	}
	if (isSheet) {
		const grid = String(item.slice_grid || "").replace(/[×X]/g, "x");
		if (
			!item.prompt.toLowerCase().includes(grid.toLowerCase()) ||
			!/(?:isolated|separated|独立|分隔|切片)/i.test(item.prompt)
		) {
			throw new Error(`${label}没有落实 Illustration Sheet 网格与切片约束。`);
		}
	}
}

function assertManifestDeckContract(
	manifest: ReturnType<typeof readPptImageManifest>["manifest"],
	rendering: string,
	palette: string,
	colors: Map<string, string>,
) {
	if (manifest.deck_rendering !== rendering) {
		throw new Error("PPT 图片清单 deck_rendering 与最终设计锁不一致。");
	}
	if (manifest.deck_palette !== palette) {
		throw new Error("PPT 图片清单 deck_palette 与最终设计锁不一致。");
	}
	const scheme = manifest.color_scheme || {};
	const expected = {
		primary: colors.get("primary"),
		secondary: colors.get("secondary_bg") || colors.get("bg"),
		accent: colors.get("accent"),
	};
	for (const [key, color] of Object.entries(expected)) {
		if (!color || String(scheme[key] || "").toUpperCase() !== color.toUpperCase()) {
			throw new Error(
				`PPT 图片清单 color_scheme.${key} 与最终设计锁不一致。`,
			);
		}
	}
}

function collectBaseReferencePaths(
	skillDir: string,
	rendering: string,
	palette: string,
	specLock: string,
) {
	const paths = [
		join(skillDir, "SKILL.md"),
		join(skillDir, "references", "image-base.md"),
		join(skillDir, "references", "image-generator.md"),
		join(skillDir, "references", "image-renderings", "_index.md"),
		join(skillDir, "references", "image-palettes", "_index.md"),
		join(skillDir, "references", "image-type-templates", "_index.md"),
	];
	for (const [family, value, behaviorKey] of [
		["image-renderings", rendering, "image_rendering_behavior"],
		["image-palettes", palette, "image_palette_behavior"],
	] as const) {
		if (value === "custom") {
			if (!readLockProse(specLock, behaviorKey)) {
				throw new Error(`PPT 图片策略 custom 缺少 ${behaviorKey}。`);
			}
			continue;
		}
		paths.push(join(skillDir, "references", family, `${value}.md`));
	}
	return paths;
}

function readAiImageResourceFilenames(projectDir: string) {
	const path = join(projectDir, "design_spec.md");
	const content = readFileSync(path, "utf-8");
	const section = content.match(
		/(?:^|\n)##\s+VIII\.\s+Image Resource List[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i,
	)?.[1];
	if (!section) {
		throw new Error("PPT AI 图片任务缺少 design_spec.md §VIII 资源表。");
	}
	const tableLines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
	const header = tableLines.find((line) => {
		const cells = parseMarkdownRow(line).map(normalizeHeader);
		return cells.includes("filename") && cells.includes("acquire via");
	});
	if (!header) throw new Error("PPT 图片资源表缺少 Filename 或 Acquire Via 列。");
	const headers = parseMarkdownRow(header).map(normalizeHeader);
	const filenameIndex = headers.indexOf("filename");
	const acquireIndex = headers.indexOf("acquire via");
	const filenames: string[] = [];
	let afterHeader = false;
	for (const line of tableLines) {
		if (line === header) {
			afterHeader = true;
			continue;
		}
		if (!afterHeader) continue;
		const cells = parseMarkdownRow(line);
		if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue;
		if (cleanCell(cells[acquireIndex]).toLowerCase() !== "ai") continue;
		const filename = basename(cleanCell(cells[filenameIndex])).toLowerCase();
		if (!filename) throw new Error("PPT 图片资源表包含空 AI 文件名。");
		filenames.push(filename);
	}
	if (filenames.length < 1 || new Set(filenames).size !== filenames.length) {
		throw new Error("PPT 图片资源表的 AI 文件名为空或重复。");
	}
	return filenames;
}

function readPromptColors(specLock: string) {
	const section = specLock.match(
		/(?:^|\n)##\s+colors\s*\n([\s\S]*?)(?=\n##\s+|$)/i,
	)?.[1] || "";
	const values = new Map<string, string>();
	for (const line of section.split(/\r?\n/)) {
		const match = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(#[0-9A-Fa-f]{6})\s*$/);
		if (match) values.set(match[1].toLowerCase(), match[2].toUpperCase());
	}
	return values;
}

function readPromptColorValues(values: Map<string, string>) {
	return unique(
		["bg", "primary", "accent", "secondary_bg", "secondary_accent", "text"]
			.map((key) => values.get(key))
			.filter((value): value is string => Boolean(value)),
	);
}

function requireLockValue(content: string, key: string) {
	const value = readLockProse(content, key);
	if (!value || !/^[A-Za-z0-9_.-]+$/.test(value)) {
		throw new Error(`PPT 图片策略缺少有效 ${key}。`);
	}
	return value;
}

function readLockProse(content: string, key: string) {
	const raw = content.match(
		new RegExp(`^\\s*-\\s+${key}:\\s*(.+?)\\s*$`, "im"),
	)?.[1];
	return raw?.trim().replace(/^['"]|['"]$/g, "") || "";
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
) {
	const normalizedPath = normalizeToolPath(projectDir, path);
	const candidates = reads.filter(
		(read) =>
			read.completedSequence < beforeSequence &&
			read.normalizedPath === normalizedPath,
	);
	if (!hasCompleteReadCoverage(path, candidates)) {
		throw new Error(
			`PPT Image_Generator 在写图片清单前未完整读取必需文件：${normalizedPath}。`,
		);
	}
	return {
		path: normalizedPath,
		sha256: sha256(path),
		sequences: candidates.map((read) => read.sequence),
	};
}

function hasCompleteReadCoverage(
	path: string,
	reads: Array<{ offset?: number; limit?: number }>,
) {
	const lineCount = readFileSync(path, "utf-8").split("\n").length;
	const intervals = reads
		.map((read) => {
			const start = Math.max(1, Math.floor(read.offset ?? 1));
			const limit = Math.min(2_000, Math.max(1, Math.floor(read.limit ?? 2_000)));
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

function resolveExclusivePath(path: string) {
	const stats = lstatSync(path);
	if (!stats.isFile() || stats.nlink !== 1) {
		throw new Error(`PPT 图片提示词证据文件不是独占普通文件：${path}。`);
	}
	return resolve(path);
}

function parseMarkdownRow(line: string) {
	const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const cells: string[] = [];
	let current = "";
	for (let index = 0; index < trimmed.length; index += 1) {
		if (trimmed[index] === "|" && trimmed[index - 1] !== "\\") {
			cells.push(current.trim());
			current = "";
		} else {
			current += trimmed[index];
		}
	}
	cells.push(current.trim());
	return cells;
}

function normalizeHeader(value: string) {
	return cleanCell(value).replace(/\s+/g, " ").toLowerCase();
}

function cleanCell(value = "") {
	return value.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
}

function sha256(path: string) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashManifestContract(
	manifest: ReturnType<typeof readPptImageManifest>["manifest"],
) {
	const items = manifest.items.map((item) => {
		const contract = { ...item };
		for (const key of [
			"status",
			"last_error",
			"generated_at",
			"model",
			"width",
			"height",
			"derived_items",
			"sliced_at",
		]) {
			delete contract[key];
		}
		return contract;
	});
	const contract = { ...manifest, items };
	delete contract.generated_at;
	return hashJson(contract);
}

function hashPlanningInputs(projectDir: string) {
	const designSpec = normalizeDesignSpecImageRuntimeFields(
		readFileSync(join(projectDir, "design_spec.md"), "utf-8"),
	);
	const specLock = readFileSync(join(projectDir, "spec_lock.md"), "utf-8");
	return createHash("sha256")
		.update(designSpec)
		.update("\n---spec-lock---\n")
		.update(specLock)
		.digest("hex");
}

function normalizeDesignSpecImageRuntimeFields(content: string) {
	const lines = content.split(/\r?\n/);
	const sectionStart = lines.findIndex((line) =>
		/^##\s+VIII\.\s+Image Resource List\b/i.test(line.trim()),
	);
	if (sectionStart < 0) return content;
	let sectionEnd = lines.length;
	for (let index = sectionStart + 1; index < lines.length; index += 1) {
		if (/^##\s+/.test(lines[index].trim())) {
			sectionEnd = index;
			break;
		}
	}
	const headerIndex = lines.findIndex((line, index) => {
		if (index <= sectionStart || index >= sectionEnd) return false;
		const headers = parseMarkdownRow(line).map(normalizeHeader);
		return headers.includes("filename") && headers.includes("acquire via");
	});
	if (headerIndex < 0) return content;
	const headers = parseMarkdownRow(lines[headerIndex]).map(normalizeHeader);
	const mutableIndexes = ["dimensions", "ratio", "status"]
		.map((header) => headers.indexOf(header))
		.filter((index) => index >= 0);
	for (let index = headerIndex + 2; index < sectionEnd; index += 1) {
		if (!lines[index].trim().startsWith("|")) continue;
		const cells = parseMarkdownRow(lines[index]);
		for (const mutableIndex of mutableIndexes) cells[mutableIndex] = "<runtime>";
		lines[index] = `| ${cells.join(" | ")} |`;
	}
	return lines.join("\n");
}

function hashJson(value: unknown) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonicalize(item)]),
	);
}

function unique<T>(values: T[]) {
	return [...new Set(values)];
}
