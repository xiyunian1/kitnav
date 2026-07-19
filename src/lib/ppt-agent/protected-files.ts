import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export interface ProtectedFileSnapshot {
	path: string;
	content: Buffer | null;
}

export interface ProtectedDirectorySnapshot {
	directory: string;
	files: ProtectedFileSnapshot[];
	allowedPaths: string[];
	allowedFileSnapshots?: ProtectedFileSnapshot[];
	directories?: string[];
}

class ProtectedFileViolationError extends Error {
	constructor(
		message: string,
		readonly paths: string[],
	) {
		super(message);
		this.name = "ProtectedFileViolationError";
	}
}

export function snapshotFiles(paths: string[]): ProtectedFileSnapshot[] {
	return paths.map((path) => {
		assertExclusiveRegularFile(path);
		return { path, content: readFileSync(path) };
	});
}

export function snapshotFileStates(paths: string[]): ProtectedFileSnapshot[] {
	return paths.map((path) => {
		if (!existsSync(path)) return { path, content: null };
		assertExclusiveRegularFile(path);
		return { path, content: readFileSync(path) };
	});
}

export function snapshotDirectoryFiles(
	directory: string,
	options: { allowChangesTo?: string[] } = {},
): ProtectedDirectorySnapshot {
	const canonicalDirectory = resolve(directory);
	const allowedPaths = (options.allowChangesTo || []).map((path) => resolve(path));
	if (allowedPaths.some((path) => dirname(path) !== canonicalDirectory)) {
		throw new Error("受保护目录的允许修改路径必须位于该目录内。");
	}
	const allowed = new Set(allowedPaths);
	const entries = readdirSync(directory, { withFileTypes: true });
	const unsupported = entries.filter((entry) => !entry.isFile());
	if (unsupported.length > 0) {
		throw new Error(
			`无法保护包含非文件条目的目录：${unsupported.map((entry) => entry.name).join("、")}。`,
		);
	}
	const entryPaths = entries.map((entry) => resolve(directory, entry.name));
	for (const path of allowedPaths.filter(existsSync)) {
		assertExclusiveRegularFile(path);
	}
	return {
		directory: canonicalDirectory,
		files: snapshotFiles(entryPaths.filter((path) => !allowed.has(path))),
		allowedPaths,
		allowedFileSnapshots: snapshotFileStates(allowedPaths),
	};
}

export function snapshotDirectoryTreeFiles(
	directory: string,
	options: { allowChangesTo?: string[] } = {},
): ProtectedDirectorySnapshot {
	const canonicalDirectory = resolve(directory);
	assertRegularDirectory(canonicalDirectory);
	const allowedPaths = (options.allowChangesTo || []).map((path) => resolve(path));
	if (
		allowedPaths.some(
			(path) => !path.startsWith(`${canonicalDirectory}${sep}`),
		)
	) {
		throw new Error("受保护目录树的允许修改路径必须位于该目录内。");
	}
	const allowed = new Set(allowedPaths);
	const files: ProtectedFileSnapshot[] = [];
	const directories: string[] = [];

	const visit = (currentDirectory: string) => {
		for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
			const path = resolve(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				assertRegularDirectory(path);
				directories.push(path);
				visit(path);
				continue;
			}
			if (!entry.isFile()) {
				throw new Error(`无法保护非普通目录条目：${entry.name}。`);
			}
			assertExclusiveRegularFile(path);
			if (!allowed.has(path)) {
				files.push({ path, content: readFileSync(path) });
			}
		}
	};
	visit(canonicalDirectory);
	return {
		directory: canonicalDirectory,
		files,
		allowedPaths,
		allowedFileSnapshots: snapshotFileStates(allowedPaths),
		directories,
	};
}

export function restoreAndRejectProtectedChanges(
	snapshots: ProtectedFileSnapshot[],
	directorySnapshots: ProtectedDirectorySnapshot[] = [],
	operation = "PPT 流程",
) {
	const changed = new Map<string, ProtectedFileSnapshot>();
	for (const snapshot of snapshots) {
		if (!isUnchangedRegularFile(snapshot)) changed.set(snapshot.path, snapshot);
	}

	const unexpected = new Set<string>();
	const changedDirectories = new Set<string>();
	for (const directorySnapshot of directorySnapshots) {
		const expectedPaths = new Set(
			[
				...directorySnapshot.files.map((snapshot) => snapshot.path),
				...directorySnapshot.allowedPaths,
				...(directorySnapshot.directories || []),
			],
		);
		if (directorySnapshot.directories) {
			if (
				!existsSync(directorySnapshot.directory) ||
				!lstatSync(directorySnapshot.directory).isDirectory()
			) {
				changedDirectories.add(directorySnapshot.directory);
			} else {
				const actualEntries = collectDirectoryTreeEntries(
					directorySnapshot.directory,
				);
				for (const [path, kind] of actualEntries) {
					if (!expectedPaths.has(path)) unexpected.add(path);
					if (
						directorySnapshot.directories.includes(path) &&
						kind !== "directory"
					) {
						changedDirectories.add(path);
					}
				}
			}
			for (const path of directorySnapshot.directories) {
				if (!existsSync(path) || !lstatSync(path).isDirectory()) {
					changedDirectories.add(path);
				}
			}
		} else if (existsSync(directorySnapshot.directory)) {
			for (const entry of readdirSync(directorySnapshot.directory)) {
				const path = join(directorySnapshot.directory, entry);
				if (!expectedPaths.has(path)) unexpected.add(path);
			}
		}
		for (const snapshot of directorySnapshot.files) {
			if (!isUnchangedRegularFile(snapshot)) {
				changed.set(snapshot.path, snapshot);
			}
		}
		for (const snapshot of directorySnapshot.allowedFileSnapshots || []) {
			if (!isAllowedFileStateValid(snapshot)) {
				changed.set(snapshot.path, snapshot);
			}
		}
	}

	for (const path of [...unexpected].sort((left, right) => right.length - left.length)) {
		rmSync(path, { recursive: true, force: true });
	}
	for (const path of [...changedDirectories].sort(
		(left, right) => left.length - right.length,
	)) {
		if (existsSync(path) && !lstatSync(path).isDirectory()) {
			rmSync(path, { recursive: true, force: true });
		}
		mkdirSync(path, { recursive: true });
	}
	for (const snapshot of changed.values()) {
		rmSync(snapshot.path, { recursive: true, force: true });
		if (snapshot.content !== null) {
			mkdirSync(dirname(snapshot.path), { recursive: true });
			writeFileSync(snapshot.path, snapshot.content);
		}
	}

	if (
		changed.size > 0 ||
		unexpected.size > 0 ||
		changedDirectories.size > 0
	) {
		const paths = [
			...changed.keys(),
			...unexpected,
			...changedDirectories,
		];
		throw new ProtectedFileViolationError(
			`${operation}越权修改了受保护文件：${[...new Set(paths.map((path) => basename(path)))].join("、")}。`,
			paths,
		);
	}
}

function assertExclusiveRegularFile(path: string) {
	const stats = lstatSync(path);
	if (!stats.isFile() || stats.nlink !== 1) {
		throw new Error(`无法保护非独占普通文件：${basename(path)}。`);
	}
}

function isExclusiveRegularFile(path: string) {
	if (!existsSync(path)) return false;
	const stats = lstatSync(path);
	return stats.isFile() && stats.nlink === 1;
}

function isAllowedFileStateValid(snapshot: ProtectedFileSnapshot) {
	if (!existsSync(snapshot.path)) return snapshot.content === null;
	return isExclusiveRegularFile(snapshot.path);
}

function assertRegularDirectory(path: string) {
	const stats = lstatSync(path);
	if (!stats.isDirectory()) {
		throw new Error(`无法保护非普通目录：${basename(path)}。`);
	}
}

function collectDirectoryTreeEntries(directory: string) {
	const entries = new Map<string, "directory" | "file" | "other">();
	const visit = (currentDirectory: string) => {
		for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
			const path = resolve(currentDirectory, entry.name);
			const kind = entry.isDirectory()
				? "directory"
				: entry.isFile()
					? "file"
					: "other";
			entries.set(path, kind);
			if (kind === "directory") visit(path);
		}
	};
	visit(directory);
	return entries;
}

export async function runWithProtectedFileGuard<T>(
	operation: () => Promise<T>,
	snapshots: ProtectedFileSnapshot[],
	directorySnapshots: ProtectedDirectorySnapshot[] = [],
	operationName = "PPT 流程",
	options: { rollbackFilesOnFailure?: ProtectedFileSnapshot[] } = {},
): Promise<T> {
	let result: T;
	try {
		result = await operation();
	} catch (operationError) {
		const recoveryErrors: unknown[] = [];
		let guardViolation: ProtectedFileViolationError | null = null;
		try {
			restoreAndRejectProtectedChanges(
				snapshots,
				directorySnapshots,
				operationName,
			);
		} catch (guardError) {
			if (guardError instanceof ProtectedFileViolationError) {
				guardViolation = guardError;
			} else {
				recoveryErrors.push(guardError);
			}
		}
		try {
			restoreFileSnapshots(options.rollbackFilesOnFailure || []);
		} catch (rollbackError) {
			recoveryErrors.push(rollbackError);
		}
		if (recoveryErrors.length > 0) {
			throw new AggregateError(
				[operationError, ...recoveryErrors],
				`${operationName}执行失败且未能完整恢复受保护文件。`,
			);
		}
		if (guardViolation) {
			throw new AggregateError(
				[operationError, guardViolation],
				`${operationName}执行失败且越权修改了受保护文件：${[
					...new Set(guardViolation.paths.map((path) => basename(path))),
				].join("、")}。`,
			);
		}
		throw operationError;
	}

	restoreAndRejectProtectedChanges(
		snapshots,
		directorySnapshots,
		operationName,
	);
	return result;
}

function restoreFileSnapshots(snapshots: ProtectedFileSnapshot[]) {
	for (const snapshot of snapshots) {
		if (isUnchangedRegularFile(snapshot)) continue;
		rmSync(snapshot.path, { recursive: true, force: true });
		if (snapshot.content !== null) {
			mkdirSync(dirname(snapshot.path), { recursive: true });
			writeFileSync(snapshot.path, snapshot.content);
		}
	}
}

function isUnchangedRegularFile(snapshot: ProtectedFileSnapshot) {
	if (snapshot.content === null) return !existsSync(snapshot.path);
	if (!existsSync(snapshot.path)) return false;
	const stats = lstatSync(snapshot.path);
	return (
		stats.isFile() &&
		stats.nlink === 1 &&
		readFileSync(snapshot.path).equals(snapshot.content)
	);
}
