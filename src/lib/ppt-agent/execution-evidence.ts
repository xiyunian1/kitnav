import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface PptAgentToolCall {
	toolCallId: string;
	toolName: string;
	path?: string;
	offset?: number;
	limit?: number;
	command?: string;
	startEventIndex?: number;
	endEventIndex?: number;
	completed: boolean;
	success: boolean;
}

export class PptAgentToolCallCollector {
	private readonly calls: PptAgentToolCall[] = [];
	private readonly callsById = new Map<string, PptAgentToolCall>();
	private captureComplete = true;
	private eventIndex = 0;

	consumeJsonLine(line: string) {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (!event || typeof event !== "object") return;
		const item = event as {
			type?: unknown;
			toolCallId?: unknown;
			toolName?: unknown;
			args?: unknown;
			isError?: unknown;
		};
		if (
			item.type === "tool_execution_start" &&
			typeof item.toolCallId === "string" &&
			typeof item.toolName === "string"
		) {
			this.eventIndex += 1;
			const args =
				item.args && typeof item.args === "object"
					? (item.args as Record<string, unknown>)
					: {};
			const call: PptAgentToolCall = {
				toolCallId: item.toolCallId,
				toolName: item.toolName.toLowerCase(),
				path: typeof args.path === "string" ? args.path : undefined,
				offset:
					typeof args.offset === "number" && Number.isFinite(args.offset)
						? args.offset
						: undefined,
				limit:
					typeof args.limit === "number" && Number.isFinite(args.limit)
						? args.limit
						: undefined,
				command: typeof args.command === "string" ? args.command : undefined,
				startEventIndex: this.eventIndex,
				completed: false,
				success: false,
			};
			this.calls.push(call);
			this.callsById.set(call.toolCallId, call);
			return;
		}
		if (
			item.type === "tool_execution_end" &&
			typeof item.toolCallId === "string"
		) {
			this.eventIndex += 1;
			const call = this.callsById.get(item.toolCallId);
			if (!call) {
				this.captureComplete = false;
				return;
			}
			call.completed = true;
			call.success = item.isError !== true;
			call.endEventIndex = this.eventIndex;
		}
	}

	markIncomplete() {
		this.captureComplete = false;
	}

	isComplete() {
		return (
			this.captureComplete && this.calls.every((call) => call.completed)
		);
	}

	getCalls() {
		return this.calls.map((call) => ({ ...call }));
	}
}

export function writePptExecutionEvidence(
	projectDir: string,
	toolCalls: PptAgentToolCall[],
	expectedSlideCount: number,
	toolCaptureComplete = true,
) {
	if (!toolCaptureComplete) {
		throw new Error("PPT Executor 工具事件记录不完整，无法验证官方执行顺序。");
	}
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
	const mutations = ordered.filter(
		(call) =>
			(call.toolName === "write" || call.toolName === "edit") &&
			/^svg_output\/.*\.svg$/i.test(call.normalizedPath),
	);
	const firstMutationByPage = new Map<number, (typeof mutations)[number]>();
	let activePage = 0;
	let activePageLastCompletion = 0;
	for (const mutation of mutations) {
		const page = parseSlideNumber(mutation.normalizedPath);
		if (!page) {
			throw new Error(
				`PPT Executor 写入的 SVG 文件名缺少可识别页码：${mutation.normalizedPath}。`,
			);
		}
		if (page < activePage) {
			throw new Error(
				`PPT Executor 已开始 P${padPage(activePage)} 后又回头修改 P${padPage(page)}，不符合严格逐页顺序。`,
				);
		}
		if (page > activePage) {
			if (activePage > 0 && activePageLastCompletion >= mutation.sequence) {
				throw new Error(
					`PPT Executor 在 P${padPage(activePage)} 写入完成前已开始 P${padPage(page)}，不符合严格逐页顺序。`,
				);
			}
			activePage = page;
			activePageLastCompletion = 0;
		}
		activePageLastCompletion = Math.max(
			activePageLastCompletion,
			mutation.completedSequence,
		);
		if (!firstMutationByPage.has(page)) firstMutationByPage.set(page, mutation);
	}
	const firstMutations = [...firstMutationByPage.entries()]
		.map(([page, call]) => ({ page, call }))
		.sort((left, right) => left.call.sequence - right.call.sequence);
	const expectedPages = Array.from(
		{ length: expectedSlideCount },
		(_, index) => index + 1,
	);
	if (
		firstMutations.length !== expectedSlideCount ||
		firstMutations.some((entry, index) => entry.page !== expectedPages[index])
	) {
		throw new Error(
			`PPT Executor 页面首次写入顺序不正确：${firstMutations.map((entry) => `P${padPage(entry.page)}`).join(" -> ") || "无写入"}。`,
		);
	}

	const reads = ordered.filter(
		(call) => call.toolName === "read" && Boolean(call.normalizedPath),
	);
	const firstSvgSequence = firstMutations[0]?.call.sequence ?? Number.MAX_SAFE_INTEGER;
	const requiredReads = collectRequiredExecutionReads(projectDir).map((path) =>
		findRequiredReadCoverage(projectDir, reads, firstSvgSequence, path),
	);
	const references = readLockedTemplateReferences(projectDir);
	const batchReads = [
		...references.layouts.map((name) =>
			findRequiredBatchRead(
				projectDir,
				reads,
				firstSvgSequence,
				"layout",
				name,
			),
		),
		...references.charts.map((name) =>
			findRequiredBatchRead(
				projectDir,
				reads,
				firstSvgSequence,
				"chart",
				name,
			),
		),
	];

	let lastSpecReadSequence = 0;
	let previousPageLastWriteSequence = 0;
	const pages = firstMutations.map(({ page, call }) => {
		const specRead = [...reads]
			.reverse()
			.find(
					(read) =>
						read.completedSequence < call.sequence &&
						read.sequence > lastSpecReadSequence &&
						read.sequence > previousPageLastWriteSequence &&
						read.normalizedPath === "spec_lock.md" &&
						isCompleteTextRead(projectDir, read),
				);
		if (!specRead) {
			throw new Error(
				`PPT Executor 在首次写入 P${padPage(page)} 前没有独立完整读取 spec_lock.md。`,
			);
		}
		lastSpecReadSequence = specRead.sequence;
		const pageMutations = mutations.filter(
			(mutation) => parseSlideNumber(mutation.normalizedPath) === page,
		);
		const lastWriteSequence = Math.max(
			...pageMutations.map((mutation) => mutation.completedSequence),
		);
		previousPageLastWriteSequence = lastWriteSequence;
		const templateBaseRead = findTemplateBaseRead(
			projectDir,
			reads,
			page,
			call.sequence,
		);
		return {
			page,
			svgPath: call.normalizedPath,
			specLockReadSequence: specRead.sequence,
			firstWriteSequence: call.sequence,
			lastWriteSequence,
			templateBaseRead,
		};
	});

	const evidencePath = join(projectDir, "validation", "execution-evidence.json");
	mkdirSync(join(projectDir, "validation"), { recursive: true });
	const temporaryPath = `${evidencePath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		temporaryPath,
		`${JSON.stringify(
				{
					schema: "ppt_hosted_execution_evidence.v1",
					verifiedAt: new Date().toISOString(),
					expectedSlideCount,
					requiredReads,
					batchReads,
				pages,
			},
			null,
			2,
		)}\n`,
		"utf-8",
	);
	renameSync(temporaryPath, evidencePath);
	return { pages, requiredReads, batchReads, evidencePath };
}

function collectRequiredExecutionReads(projectDir: string) {
	const required = [
		join(projectDir, "design_spec.md"),
		join(projectDir, "sources", "source.md"),
		join(projectDir, "analysis", "content_brief.md"),
		join(projectDir, "analysis", "source_index.json"),
		join(projectDir, "analysis", "source_profile.json"),
		join(projectDir, "analysis", "image_analysis.csv"),
		join(projectDir, "images", "image_prompts.json"),
		join(projectDir, "images", "image_prompts.md"),
	].filter(existsSync);
	const skillDir = join(projectDir, ".ppt-master-skill");
	const skillFile = join(skillDir, "SKILL.md");
	if (existsSync(skillFile)) {
		for (const relativePath of [
			"SKILL.md",
			join("workflows", "resume-execute.md"),
			join("references", "executor-base.md"),
			join("references", "shared-standards.md"),
			join("references", "image-layout-spec.md"),
			join("references", "svg-image-embedding.md"),
		]) {
			const path = join(skillDir, relativePath);
			if (!existsSync(path)) {
				throw new Error(`PPT Executor 缺少官方必读文件：${relativePath}。`);
			}
			required.push(path);
		}
		const locked = readLockedModeAndStyle(projectDir);
		for (const [family, id] of [
			["modes", locked.mode],
			["visual-styles", locked.visualStyle],
		] as const) {
			if (!id || id === "custom") continue;
			const path = join(skillDir, "references", family, `${id}.md`);
			if (!existsSync(path)) {
				throw new Error(`PPT Executor 缺少锁定参考文件：${family}/${id}.md。`);
			}
			required.push(path);
		}
	}
	return unique(required);
}

function readLockedModeAndStyle(projectDir: string) {
	const content = readFileSync(join(projectDir, "spec_lock.md"), "utf-8");
	return {
		mode: content.match(/^\s*-\s+mode:\s*([A-Za-z0-9_.-]+)\s*$/im)?.[1] || "",
		visualStyle:
			content.match(
				/^\s*-\s+visual_style:\s*([A-Za-z0-9_.-]+)\s*$/im,
			)?.[1] || "",
	};
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
	firstSvgSequence: number,
	path: string,
) {
	const normalizedPath = normalizeToolPath(projectDir, path);
	const candidates = reads.filter(
		(read) =>
			read.completedSequence < firstSvgSequence &&
			read.normalizedPath === normalizedPath,
	);
	if (!hasCompleteTextReadCoverage(path, candidates)) {
		throw new Error(
			`PPT Executor 在首个 SVG 前未完整读取必需文件：${normalizedPath}。`,
		);
	}
	return {
		path: normalizedPath,
		sequences: candidates.map((read) => read.sequence),
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

function readLockedTemplateReferences(projectDir: string) {
	const specLockPath = join(projectDir, "spec_lock.md");
	if (!existsSync(specLockPath)) {
		throw new Error("PPT Executor 执行证据校验缺少 spec_lock.md。");
	}
	const content = readFileSync(specLockPath, "utf-8");
	return {
		layouts: unique(parsePageReferenceSection(content, "page_layouts")),
		charts: unique(parsePageReferenceSection(content, "page_charts")),
	};
}

function parsePageReferenceSection(content: string, section: string) {
	const match = content.match(
		new RegExp(`(?:^|\\n)##\\s+${section}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i"),
	);
	return (match?.[1]?.split(/\r?\n/) || [])
		.map((line) => line.match(/^-\s+P\d{1,3}\s*:\s*([A-Za-z0-9_.-]+)\s*$/i)?.[1])
		.filter((value): value is string => Boolean(value));
}

function findRequiredBatchRead(
	projectDir: string,
	reads: Array<{
		sequence: number;
		completedSequence: number;
		normalizedPath: string;
		offset?: number;
		limit?: number;
	}>,
	firstSvgSequence: number,
	kind: "layout" | "chart",
	name: string,
) {
	const suffix =
		kind === "chart" ? `/templates/charts/${name}.svg` : `/templates/${name}.svg`;
	const read = reads.find(
		(candidate) =>
			candidate.completedSequence < firstSvgSequence &&
			(`/${candidate.normalizedPath}`).endsWith(suffix) &&
			isCompleteTextRead(projectDir, candidate),
	);
	if (!read) {
		throw new Error(
			`PPT Executor 在首个 SVG 前未批量读取锁定${kind === "chart" ? "图表" : "版式"}模板 ${name}.svg。`,
		);
	}
	return { kind, name, path: read.normalizedPath, sequence: read.sequence };
}

function findTemplateBaseRead(
	projectDir: string,
	reads: Array<{
		sequence: number;
		completedSequence: number;
		normalizedPath: string;
		offset?: number;
		limit?: number;
	}>,
	page: number,
	writeSequence: number,
) {
	if (!existsSync(join(projectDir, "template_refs", "template-map.md"))) {
		return null;
	}
	const prefix = `template_refs/target_${padPage(page)}_`;
	const read = reads.find(
		(candidate) =>
			candidate.completedSequence < writeSequence &&
			candidate.normalizedPath.startsWith(prefix) &&
			candidate.normalizedPath.toLowerCase().endsWith(".svg") &&
			isCompleteTextRead(projectDir, candidate),
	);
	if (!read) {
		throw new Error(
			`PPT Executor 在首次写入 P${padPage(page)} 前未读取对应外部模板底稿。`,
		);
	}
	return { path: read.normalizedPath, sequence: read.sequence };
}

function isCompleteTextRead(
	projectDir: string,
	read: { normalizedPath: string; offset?: number; limit?: number },
) {
	if (read.offset !== undefined && read.offset > 1) return false;
	const path = isAbsolute(read.normalizedPath)
		? read.normalizedPath
		: join(projectDir, read.normalizedPath);
	if (!existsSync(path)) return false;
	const lineCount = readFileSync(path, "utf-8").split("\n").length;
	const requestedLimit = read.limit === undefined ? 2_000 : Math.floor(read.limit);
	const effectiveLimit = Math.min(2_000, Math.max(1, requestedLimit));
	return effectiveLimit >= lineCount;
}

function normalizeToolPath(projectDir: string, inputPath: string) {
	const root = realpathSync(resolve(projectDir));
	const candidate = isAbsolute(inputPath)
		? resolve(inputPath)
		: resolve(projectDir, inputPath);
	const canonical = existsSync(candidate) ? realpathSync(candidate) : candidate;
	const normalized = relative(root, canonical).replaceAll(sep, "/");
	if (!normalized || normalized === ".") return "";
	if (normalized === ".." || normalized.startsWith("../")) {
		return canonical.replaceAll(sep, "/");
	}
	return normalized;
}

function parseSlideNumber(path: string) {
	const file = path.split("/").at(-1) || "";
	const leading = file.match(/^(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	const named = file.match(/(?:^|[_-])slide[_-]?(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	return Number(leading || named || 0);
}

function unique(values: string[]) {
	return [...new Set(values)];
}

function padPage(page: number) {
	return String(page).padStart(2, "0");
}
