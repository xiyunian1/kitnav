import { lstatSync, realpathSync, type Dirent } from "fs";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "fs/promises";
import { basename, join, resolve, sep } from "path";
import { withUploadStorageLock } from "@/lib/upload-storage-lock";

const PPT_UPLOAD_ROOT = resolve(
	/* turbopackIgnore: true */ process.env.PPT_UPLOAD_ROOT ||
		join(process.cwd(), "data", "ppt-uploads"),
);

export function getPptUploadRoot() {
	return PPT_UPLOAD_ROOT;
}

export async function assertPptUploadQuota(
	userId: string,
	incomingBytes: number,
) {
	if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
		throw new Error("无效的用户标识。");
	}
	const maxBytes = positiveIntegerEnv(
		"PPT_UPLOAD_USER_QUOTA_BYTES",
		200 * 1024 * 1024,
	);
	const maxFiles = positiveIntegerEnv("PPT_UPLOAD_USER_MAX_FILES", 50);
	const userDir = join(
		/* turbopackIgnore: true */ PPT_UPLOAD_ROOT,
		userId,
	);
	let entries: Dirent[] = [];
	try {
		entries = await readdir(userDir, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	const files = entries.filter((entry) => entry.isFile());
	if (files.length >= maxFiles) {
		throw new Error("上传文件数量已达上限，请稍后再试。");
	}
	let usedBytes = 0;
	for (const file of files) {
		const filePath = join(
			/* turbopackIgnore: true */ userDir,
			file.name,
		);
		usedBytes += (await stat(/* turbopackIgnore: true */ filePath)).size;
	}
	if (usedBytes + incomingBytes > maxBytes) {
		const maxMegabytes = Math.round(maxBytes / 1024 / 1024);
		throw new Error(
			`上传空间不足，每个用户最多保留 ${maxMegabytes}MB 待处理文件。`,
		);
	}
}

export async function savePptUpload(
	userId: string,
	storageName: string,
	buffer: Buffer,
) {
	if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
		throw new Error("无效的用户标识。");
	}
	const safeName = basename(storageName);
	if (!safeName || safeName !== storageName || safeName.includes("..")) {
		throw new Error("无效的上传文件标识。");
	}
	const userDir = join(
		/* turbopackIgnore: true */ PPT_UPLOAD_ROOT,
		userId,
	);
	const absolutePath = join(
		/* turbopackIgnore: true */ userDir,
		safeName,
	);
	assertInsideUploadRoot(absolutePath);

	return withUploadStorageLock("ppt", userId, async () => {
		await mkdir(userDir, { recursive: true, mode: 0o700 });
		const userDirInfo = lstatSync(/* turbopackIgnore: true */ userDir);
		if (!userDirInfo.isDirectory() || userDirInfo.isSymbolicLink()) {
			throw new Error("上传目录无效。");
		}
		await chmod(userDir, 0o700);
		assertRealPathInside(
			realpathSync(/* turbopackIgnore: true */ PPT_UPLOAD_ROOT),
			realpathSync(/* turbopackIgnore: true */ userDir),
		);
		await assertPptUploadQuota(userId, buffer.length);
		try {
			await writeFile(absolutePath, buffer, { mode: 0o600, flag: "wx" });
			return absolutePath;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
				await rm(absolutePath, { force: true });
			}
			throw error;
		}
	});
}

/**
 * 把上传返回的不透明 token（服务端生成的文件名）解析回安全的服务器路径。
 *
 * 客户端只看到 token，绝对路径永不离开服务器。token 会被 basename 规范化并强制
 * 限定在当前用户的上传目录内，因此 A 用户无法引用 B 用户的文件，也无法以 ../
 * 逃逸出上传根。
 */
export function resolveUploadPath(userId: string, token: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
		throw new Error("无效的用户标识。");
	}
	const safe = basename(token);
	if (!safe || safe !== token || safe.includes("..") || /[\\/]/.test(safe)) {
		throw new Error("无效的上传文件标识。");
	}
	const abs = join(
		/* turbopackIgnore: true */ PPT_UPLOAD_ROOT,
		userId,
		safe,
	);
	assertInsideUploadRoot(abs);
	let info;
	try {
		info = lstatSync(/* turbopackIgnore: true */ abs);
	} catch {
		throw new Error("上传文件不存在或已过期，请重新上传。");
	}
	if (!info.isFile() || info.isSymbolicLink()) {
		throw new Error("上传文件不存在或已过期，请重新上传。");
	}
	const rootRealPath = realpathSync(/* turbopackIgnore: true */ PPT_UPLOAD_ROOT);
	const fileRealPath = realpathSync(/* turbopackIgnore: true */ abs);
	assertRealPathInside(rootRealPath, fileRealPath);
	return fileRealPath;
}

function assertRealPathInside(root: string, candidate: string) {
	const realRoot = root.endsWith(sep) ? root : `${root}${sep}`;
	if (!candidate.startsWith(realRoot)) {
		throw new Error("上传文档路径非法。");
	}
}

export function assertInsideUploadRoot(path: string) {
	const root = PPT_UPLOAD_ROOT.endsWith(sep)
		? PPT_UPLOAD_ROOT
		: `${PPT_UPLOAD_ROOT}${sep}`;
	if (path !== PPT_UPLOAD_ROOT && !path.startsWith(root)) {
		throw new Error("上传文档路径非法。");
	}
}

function positiveIntegerEnv(name: string, fallback: number) {
	const value = Number(process.env[name]);
	return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
