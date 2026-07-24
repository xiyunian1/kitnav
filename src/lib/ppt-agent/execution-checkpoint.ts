import { randomUUID } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	assertPptExecutionEvidence,
	type PptAgentToolCall,
	writePptExecutionEvidence,
} from "./execution-evidence";
import {
	isPptAgentContextManifest,
	type PptAgentContextManifest,
} from "./agent-context-bundle";
import { assertPptSpeakerNotesSource } from "./output-validation";
import { findXmlWellFormednessError } from "./xml-validate";

const CHECKPOINT_SCHEMA = "ppt_hosted_execution_checkpoint.v1";
const POINTER_FILENAME = "execution-checkpoint.json";
const SNAPSHOT_DIRECTORY = "executor-checkpoints";

interface StoredPptExecutionCheckpoint {
	schema: typeof CHECKPOINT_SCHEMA;
	version: string;
	sessionId: string;
	stopReason: string;
	turn: number;
	svgCount: number;
	toolCalls: PptAgentToolCall[];
	toolCaptureComplete: true;
	contextBundle?: PptAgentContextManifest;
	speakerNotesComplete: boolean;
	savedAt: string;
}

export interface PptExecutionCheckpoint extends StoredPptExecutionCheckpoint {
	snapshotDir: string;
}

export interface SavePptExecutionCheckpointInput {
	projectDir: string;
	sessionId: string;
	stopReason: string;
	turn: number;
	expectedSlideCount: number;
	toolCalls: PptAgentToolCall[];
	toolCaptureComplete: boolean;
	contextBundle?: PptAgentContextManifest;
}

export function loadPptExecutionCheckpoint(
	projectDir: string,
	expectedSlideCount: number,
): PptExecutionCheckpoint | null {
	const pointerPath = getCheckpointPointerPath(projectDir);
	if (!existsSync(pointerPath)) return null;

	let value: unknown;
	try {
		value = JSON.parse(readFileSync(pointerPath, "utf-8"));
	} catch (error) {
		throw new Error(
			`PPT Executor 检查点无法读取：${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isStoredCheckpoint(value)) {
		throw new Error("PPT Executor 检查点格式无效。");
	}
	if (value.svgCount < 1 || value.svgCount > expectedSlideCount) {
		throw new Error(
			`PPT Executor 检查点页数无效：${value.svgCount}/${expectedSlideCount}。`,
		);
	}
	const snapshotDir = getCheckpointVersionPath(projectDir, value.version);
	if (
		!existsSync(snapshotDir) ||
		countSvgFiles(join(snapshotDir, "svg_output")) !== value.svgCount
	) {
		throw new Error("PPT Executor 检查点页面快照不完整。");
	}
	if (!hasAgentSession(projectDir, value.sessionId)) {
		throw new Error("PPT Executor 检查点对应的 Pi 会话已不存在。");
	}
	return { ...value, snapshotDir };
}

export function savePptExecutionCheckpoint(
	input: SavePptExecutionCheckpointInput,
): PptExecutionCheckpoint | null {
	const svgCount = countSvgFiles(join(input.projectDir, "svg_output"));
	if (svgCount === 0) return null;
	if (svgCount > input.expectedSlideCount) {
		throw new Error(
			`PPT Executor 生成页数超出目标：${svgCount}/${input.expectedSlideCount}。`,
		);
	}
	assertSvgSnapshot(join(input.projectDir, "svg_output"), svgCount);

	writePptExecutionEvidence(
		input.projectDir,
		input.toolCalls,
		svgCount,
		input.toolCaptureComplete,
		input.contextBundle,
	);
	let speakerNotesComplete = false;
	if (svgCount === input.expectedSlideCount) {
		try {
			assertPptSpeakerNotesSource(input.projectDir, input.expectedSlideCount);
			speakerNotesComplete = true;
		} catch {
			// A later continuation may still create or repair notes/total.md.
		}
	}

	const version = `${Date.now()}-${randomUUID()}`;
	const snapshotsRoot = getCheckpointSnapshotsRoot(input.projectDir);
	const temporaryDir = join(snapshotsRoot, `.tmp-${version}`);
	const snapshotDir = getCheckpointVersionPath(input.projectDir, version);
	mkdirSync(snapshotsRoot, { recursive: true });
	rmSync(temporaryDir, { recursive: true, force: true });
	mkdirSync(temporaryDir, { recursive: true });
	cpSync(join(input.projectDir, "svg_output"), join(temporaryDir, "svg_output"), {
		recursive: true,
	});
	const notesDir = join(input.projectDir, "notes");
	if (existsSync(notesDir)) {
		cpSync(notesDir, join(temporaryDir, "notes"), { recursive: true });
	}

	const stored: StoredPptExecutionCheckpoint = {
		schema: CHECKPOINT_SCHEMA,
		version,
		sessionId: input.sessionId,
		stopReason: input.stopReason,
		turn: Math.max(1, Math.floor(input.turn)),
		svgCount,
		toolCalls: input.toolCalls.map((call) => ({ ...call })),
		toolCaptureComplete: true,
		contextBundle: input.contextBundle,
		speakerNotesComplete,
		savedAt: new Date().toISOString(),
	};
	writeFileSync(
		join(temporaryDir, "manifest.json"),
		`${JSON.stringify(stored, null, 2)}\n`,
		"utf-8",
	);
	renameSync(temporaryDir, snapshotDir);

	const pointerPath = getCheckpointPointerPath(input.projectDir);
	const temporaryPointer = `${pointerPath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(
		temporaryPointer,
		`${JSON.stringify(stored, null, 2)}\n`,
		"utf-8",
	);
	renameSync(temporaryPointer, pointerPath);
	try {
		removeObsoleteSnapshots(snapshotsRoot, version);
	} catch {
		// The pointer already references a complete snapshot; stale versions are harmless.
	}
	return { ...stored, snapshotDir };
}

export function restorePptExecutionCheckpoint(
	projectDir: string,
	checkpoint: PptExecutionCheckpoint,
) {
	const snapshotSvgDir = join(checkpoint.snapshotDir, "svg_output");
	assertSvgSnapshot(snapshotSvgDir, checkpoint.svgCount);
	assertPptExecutionEvidence(
		projectDir,
		checkpoint.toolCalls,
		checkpoint.svgCount,
		checkpoint.toolCaptureComplete,
		checkpoint.contextBundle,
	);

	const restoreId = randomUUID();
	const stagingRoot = join(projectDir, `.executor-restore-${restoreId}`);
	const backupRoot = join(projectDir, `.executor-backup-${restoreId}`);
	const stagedSvgDir = join(stagingRoot, "svg_output");
	const stagedNotesDir = join(stagingRoot, "notes");
	rmSync(stagingRoot, { recursive: true, force: true });
	rmSync(backupRoot, { recursive: true, force: true });
	mkdirSync(stagingRoot, { recursive: true });
	cpSync(snapshotSvgDir, stagedSvgDir, { recursive: true });
	const checkpointNotes = join(checkpoint.snapshotDir, "notes");
	if (existsSync(checkpointNotes)) {
		cpSync(checkpointNotes, stagedNotesDir, { recursive: true });
	} else {
		mkdirSync(stagedNotesDir, { recursive: true });
	}
	assertSvgSnapshot(stagedSvgDir, checkpoint.svgCount);
	if (checkpoint.speakerNotesComplete) {
		assertNonEmptyFile(
			join(stagedNotesDir, "total.md"),
			"PPT Executor 检查点讲稿已损坏。",
		);
	}

	const swapped: Array<{ name: string; hadOriginal: boolean }> = [];
	try {
		mkdirSync(backupRoot, { recursive: true });
		for (const name of ["svg_output", "notes"]) {
			const target = join(projectDir, name);
			const backup = join(backupRoot, name);
			const staged = join(stagingRoot, name);
			const hadOriginal = existsSync(target);
			if (hadOriginal) renameSync(target, backup);
			try {
				renameSync(staged, target);
				swapped.push({ name, hadOriginal });
			} catch (error) {
				if (hadOriginal && existsSync(backup)) renameSync(backup, target);
				throw error;
			}
		}
		clearValidationArtifacts(projectDir);
		writePptExecutionEvidence(
			projectDir,
			checkpoint.toolCalls,
			checkpoint.svgCount,
			checkpoint.toolCaptureComplete,
			checkpoint.contextBundle,
		);
		for (const name of ["svg_final", "exports", ".preview", ".review"]) {
			resetDirectory(join(projectDir, name));
		}
	} catch (error) {
		for (const item of [...swapped].reverse()) {
			const target = join(projectDir, item.name);
			const backup = join(backupRoot, item.name);
			rmSync(target, { recursive: true, force: true });
			if (item.hadOriginal && existsSync(backup)) renameSync(backup, target);
		}
		throw error;
	} finally {
		rmSync(stagingRoot, { recursive: true, force: true });
		rmSync(backupRoot, { recursive: true, force: true });
	}
}

export function discardPptExecutionCheckpoint(projectDir: string) {
	rmSync(getCheckpointPointerPath(projectDir), { force: true });
	rmSync(getCheckpointSnapshotsRoot(projectDir), {
		recursive: true,
		force: true,
	});
}

function getCheckpointPointerPath(projectDir: string) {
	return join(projectDir, "validation", POINTER_FILENAME);
}

function getCheckpointSnapshotsRoot(projectDir: string) {
	return join(projectDir, "validation", SNAPSHOT_DIRECTORY);
}

function getCheckpointVersionPath(projectDir: string, version: string) {
	return join(getCheckpointSnapshotsRoot(projectDir), version);
}

function isStoredCheckpoint(value: unknown): value is StoredPptExecutionCheckpoint {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<StoredPptExecutionCheckpoint>;
	return (
		item.schema === CHECKPOINT_SCHEMA &&
		typeof item.version === "string" &&
		/^[a-zA-Z0-9-]+$/.test(item.version) &&
		typeof item.sessionId === "string" &&
		item.sessionId.length > 0 &&
		typeof item.stopReason === "string" &&
		typeof item.turn === "number" &&
		Number.isInteger(item.turn) &&
		typeof item.svgCount === "number" &&
		Number.isInteger(item.svgCount) &&
		Array.isArray(item.toolCalls) &&
		item.toolCalls.every(isStoredToolCall) &&
		item.toolCaptureComplete === true &&
		(item.contextBundle === undefined ||
			isPptAgentContextManifest(item.contextBundle)) &&
		typeof item.speakerNotesComplete === "boolean" &&
		typeof item.savedAt === "string"
	);
}

function isStoredToolCall(value: unknown): value is PptAgentToolCall {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<PptAgentToolCall>;
	return (
		typeof item.toolCallId === "string" &&
		item.toolCallId.length > 0 &&
		typeof item.toolName === "string" &&
		item.toolName.length > 0 &&
		(item.path === undefined || typeof item.path === "string") &&
		(item.command === undefined || typeof item.command === "string") &&
		isOptionalFiniteNumber(item.offset) &&
		isOptionalFiniteNumber(item.limit) &&
		isOptionalFiniteNumber(item.startEventIndex) &&
		isOptionalFiniteNumber(item.endEventIndex) &&
		typeof item.completed === "boolean" &&
		typeof item.success === "boolean"
	);
}

function isOptionalFiniteNumber(value: unknown) {
	return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function hasAgentSession(projectDir: string, sessionId: string) {
	const sessionDir = join(projectDir, ".pi-sessions");
	if (!existsSync(sessionDir)) return false;
	return readdirSync(sessionDir).some(
		(name) =>
			name === `${sessionId}.jsonl` || name.endsWith(`_${sessionId}.jsonl`),
	);
}

function countSvgFiles(path: string) {
	if (!existsSync(path)) return 0;
	return readdirSync(path, { withFileTypes: true }).filter(
		(entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"),
	).length;
}

function assertSvgSnapshot(path: string, expectedCount: number) {
	if (!existsSync(path)) {
		throw new Error("PPT Executor 检查点页面快照已损坏。");
	}
	const entries = readdirSync(path, { withFileTypes: true });
	const svgEntries = entries.filter((entry) =>
		entry.name.toLowerCase().endsWith(".svg"),
	);
	if (
		svgEntries.length !== expectedCount ||
		svgEntries.some((entry) => !entry.isFile())
	) {
		throw new Error("PPT Executor 检查点页面快照已损坏。");
	}
	for (const entry of svgEntries) {
		const content = readFileSync(join(path, entry.name), "utf-8");
		const rootTag = content
			.replace(/<!--[\s\S]*?-->/g, "")
			.match(/<(?![!?])\s*([A-Za-z_][\w:.-]*)\b/)?.[1];
		const xmlError = findXmlWellFormednessError(content);
		if (
			!rootTag ||
			(rootTag.toLowerCase() !== "svg" &&
				!rootTag.toLowerCase().endsWith(":svg")) ||
			xmlError
		) {
			throw new Error(
				`PPT Executor 检查点页面 ${entry.name} 不是有效 SVG${xmlError ? `：${xmlError}` : "。"}`,
			);
		}
	}
}

function assertNonEmptyFile(path: string, message: string) {
	if (!existsSync(path) || readFileSync(path).length === 0) {
		throw new Error(message);
	}
}

function resetDirectory(path: string) {
	rmSync(path, { recursive: true, force: true });
	mkdirSync(path, { recursive: true });
}

function clearValidationArtifacts(projectDir: string) {
	const validationDir = join(projectDir, "validation");
	mkdirSync(validationDir, { recursive: true });
	for (const entry of readdirSync(validationDir, { withFileTypes: true })) {
		if (entry.name === SNAPSHOT_DIRECTORY || entry.name === POINTER_FILENAME) {
			continue;
		}
		rmSync(join(validationDir, entry.name), { recursive: true, force: true });
	}
}

function removeObsoleteSnapshots(root: string, currentVersion: string) {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === currentVersion) continue;
		rmSync(join(root, entry.name), { recursive: true, force: true });
	}
}
