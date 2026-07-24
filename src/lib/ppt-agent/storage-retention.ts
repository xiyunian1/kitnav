import { lstat, readdir, rm, rmdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { PPT_PROJECTS_ROOT } from "./paths";
import {
	assertInsideUploadRoot,
	getPptUploadRoot,
	resolveUploadPath,
} from "./upload-paths";
import {
	PPT_COMPLETED_STATUSES,
	PPT_PROCESSING_STATUSES,
} from "./status";
import { tryAcquirePptStorageSweepLock } from "./storage-lock";
import { GENERATED_ARTIFACT_RETENTION_MS } from "@/lib/generated-artifact-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

interface StorageSweepInput {
	uploadRoot: string;
	projectRoot: string;
	activeUploadPaths: ReadonlySet<string>;
	knownProjectIds: ReadonlySet<string>;
	now: number;
	uploadRetentionMs: number;
	orphanProjectRetentionMs: number;
}

export interface StorageSweepResult {
	uploadsRemoved: number;
	uploadBytesRemoved: number;
	projectDirsRemoved: number;
	projectArtifactsRemoved: number;
	projectArtifactBytesRemoved: number;
}

export interface PptStorageSweepRunResult extends StorageSweepResult {
	skipped: boolean;
}

export async function sweepPptStorage(): Promise<PptStorageSweepRunResult> {
	return prisma.$transaction(
		async (tx) => {
			if (!(await tryAcquirePptStorageSweepLock(tx))) {
				return { ...emptyStorageSweepResult(), skipped: true };
			}
			const result = await sweepPptStorageWithLock(tx);
			return { ...result, skipped: false };
		},
		{
			maxWait: 15_000,
			timeout: positiveIntegerEnv(
				"PPT_STORAGE_SWEEP_TIMEOUT_MS",
				10 * 60 * 1000,
			),
		},
	);
}

async function sweepPptStorageWithLock(tx: Prisma.TransactionClient) {
	const activeStatuses = PPT_PROCESSING_STATUSES;
	const projects = await tx.pptProject.findMany({
		where: { status: { in: [...activeStatuses] } },
		select: {
			userId: true,
			params: true,
			sourceFileUrl: true,
		},
	});
	const activeUploadPaths = new Set<string>();
	for (const project of projects) {
		collectUploadPaths(project.params, activeUploadPaths);
		if (project.sourceFileUrl) {
			try {
				activeUploadPaths.add(
					resolveUploadPath(project.userId, project.sourceFileUrl),
				);
			} catch {
				// Newer projects keep absolute source paths in params; old missing tokens are ignored.
			}
		}
	}

	const now = Date.now();
	const orphanProjectRetentionMs =
		positiveIntegerEnv("PPT_ORPHAN_PROJECT_RETENTION_HOURS", 24) *
		60 *
		60 *
		1000;
	const orphanCandidates = await staleProjectDirectoryNames(
		PPT_PROJECTS_ROOT,
		now - orphanProjectRetentionMs,
	);
	const knownProjectIds = await findKnownProjectIds(tx, orphanCandidates);
	const fileResult = await sweepPptStorageFiles({
		uploadRoot: getPptUploadRoot(),
		projectRoot: PPT_PROJECTS_ROOT,
		activeUploadPaths,
		knownProjectIds,
		now,
		uploadRetentionMs:
			positiveIntegerEnv("PPT_UPLOAD_RETENTION_HOURS", 24) * 60 * 60 * 1000,
		orphanProjectRetentionMs,
	});
	const artifactResult = await sweepExpiredPptArtifacts(now);
	return { ...fileResult, ...artifactResult };
}

export async function sweepPptStorageFiles(
	input: StorageSweepInput,
): Promise<StorageSweepResult> {
	const result = emptyStorageSweepResult();
	const uploadCutoff = input.now - input.uploadRetentionMs;
	const projectCutoff = input.now - input.orphanProjectRetentionMs;
	const uploadRoot = resolve(input.uploadRoot);
	const projectRoot = resolve(input.projectRoot);

	for (const userEntry of await readDirOrEmpty(uploadRoot)) {
		if (!userEntry.isDirectory()) continue;
		const userDir = join(uploadRoot, userEntry.name);
		for (const fileEntry of await readDirOrEmpty(userDir)) {
			const filePath = join(userDir, fileEntry.name);
			const info = await stat(filePath).catch(() => null);
			if (
				!info ||
				info.mtimeMs >= uploadCutoff ||
				input.activeUploadPaths.has(filePath)
			) {
				continue;
			}
			assertInsideRoot(uploadRoot, filePath);
			await rm(filePath, { recursive: fileEntry.isDirectory(), force: true });
			result.uploadsRemoved += 1;
			result.uploadBytesRemoved += info.size;
		}
		await rmdir(userDir).catch(() => undefined);
	}

	for (const projectEntry of await readDirOrEmpty(projectRoot)) {
		if (
			input.knownProjectIds.has(projectEntry.name) ||
			(!projectEntry.isDirectory() && !projectEntry.isSymbolicLink())
		) {
			continue;
		}
		const projectPath = join(projectRoot, projectEntry.name);
		const info = await stat(projectPath).catch(() => null);
		if (!info || info.mtimeMs >= projectCutoff) continue;
		assertInsideRoot(projectRoot, projectPath);
		await rm(projectPath, { recursive: true, force: true });
		result.projectDirsRemoved += 1;
	}

	return result;
}

async function staleProjectDirectoryNames(root: string, cutoff: number) {
	const names: string[] = [];
	for (const entry of await readDirOrEmpty(root)) {
		if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
		const info = await lstat(join(root, entry.name)).catch(() => null);
		if (info && info.mtimeMs < cutoff) names.push(entry.name);
	}
	return names;
}

async function findKnownProjectIds(
	tx: Prisma.TransactionClient,
	candidateIds: string[],
) {
	const known = new Set<string>();
	const validIds = candidateIds.filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
	for (let index = 0; index < validIds.length; index += 500) {
		const rows = await tx.pptProject.findMany({
			where: { id: { in: validIds.slice(index, index + 500) } },
			select: { id: true },
		});
		for (const row of rows) known.add(row.id);
	}
	return known;
}

function emptyStorageSweepResult(): StorageSweepResult {
	return {
		uploadsRemoved: 0,
		uploadBytesRemoved: 0,
		projectDirsRemoved: 0,
		projectArtifactsRemoved: 0,
		projectArtifactBytesRemoved: 0,
	};
}

export async function sweepExpiredPptArtifacts(now = Date.now()) {
	const artifactCutoff = new Date(now - GENERATED_ARTIFACT_RETENTION_MS);
	const projects = await prisma.pptProject.findMany({
		where: {
			artifactsDeletedAt: null,
			status: { in: [...PPT_COMPLETED_STATUSES, "FAILED"] },
			OR: [
				{ completedAt: { lte: artifactCutoff } },
				{ completedAt: null, updatedAt: { lte: artifactCutoff } },
			],
		},
		select: { id: true, status: true, updatedAt: true },
		orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
		take: 50,
	});
	let projectArtifactsRemoved = 0;
	let projectArtifactBytesRemoved = 0;
	for (const project of projects) {
		const cleanupStartedAt = new Date();
		const claimed = await prisma.pptProject.updateMany({
			where: {
				id: project.id,
				status: project.status,
				artifactsDeletedAt: null,
			},
			data: {
				artifactsDeletedAt: cleanupStartedAt,
				updatedAt: project.updatedAt,
			},
		});
		if (claimed.count !== 1) continue;
		const projectDir = join(PPT_PROJECTS_ROOT, project.id);
		try {
			const bytes = await directorySize(projectDir);
			assertInsideRoot(resolve(PPT_PROJECTS_ROOT), resolve(projectDir));
			await rm(projectDir, { recursive: true, force: true });
			await prisma.pptProject.updateMany({
				where: { id: project.id, artifactsDeletedAt: cleanupStartedAt },
				data: {
					projectPath: null,
					specPath: null,
					specLockPath: null,
					svgOutputPath: null,
					pptxPath: null,
					logs: null,
					params: null,
					topic: null,
					sourceTopic: null,
					sourceText: null,
					sourceMarkdown: null,
					sourceFileUrl: null,
					sourceUrl: null,
					outline: null,
					updatedAt: project.updatedAt,
				},
			});
			projectArtifactsRemoved += 1;
			projectArtifactBytesRemoved += bytes;
		} catch (error) {
			await prisma.pptProject
				.updateMany({
					where: { id: project.id, artifactsDeletedAt: cleanupStartedAt },
					data: {
						artifactsDeletedAt: null,
						updatedAt: project.updatedAt,
					},
				})
				.catch(() => undefined);
			logger.error("ppt-storage", "清理过期 PPT 生成文件失败", {
				projectId: project.id,
				error,
			});
		}
	}
	return { projectArtifactsRemoved, projectArtifactBytesRemoved };
}

async function directorySize(path: string): Promise<number> {
	const info = await lstat(path).catch(() => null);
	if (!info) return 0;
	if (!info.isDirectory()) return info.isFile() ? info.size : 0;
	let bytes = 0;
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) continue;
		bytes += await directorySize(join(path, entry.name));
	}
	return bytes;
}

function collectUploadPaths(params: string | null, output: Set<string>) {
	if (!params) return;
	try {
		const parsed = JSON.parse(params) as Record<string, unknown>;
		for (const key of [
			"sourceFileUrl",
			"sourceFileUrls",
			"templateFileUrls",
		]) {
			const values = Array.isArray(parsed[key]) ? parsed[key] : [parsed[key]];
			for (const value of values) {
				if (typeof value !== "string") continue;
				const path = resolve(value);
				try {
					assertInsideUploadRoot(path);
					output.add(path);
				} catch {
					// Ignore corrupt legacy params rather than allowing them to widen the root.
				}
			}
		}
	} catch {
		// Corrupt params are handled by the worker when it attempts to rebuild the task.
	}
}

async function readDirOrEmpty(path: string) {
	try {
		return await readdir(path, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function assertInsideRoot(root: string, path: string) {
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	if (!path.startsWith(prefix)) throw new Error("PPT storage path escaped its root");
}

function positiveIntegerEnv(name: string, fallback: number) {
	const value = Number(process.env[name]);
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const PPT_STORAGE_DEFAULT_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const PPT_STORAGE_MIN_SWEEP_INTERVAL_MS = 60 * 1000;
export const PPT_STORAGE_DEFAULT_RETENTION_MS = DAY_MS;
