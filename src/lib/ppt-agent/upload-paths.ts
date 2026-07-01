import { existsSync } from "fs";
import { basename, join, resolve, sep } from "path";

const PPT_UPLOAD_ROOT = resolve(process.cwd(), "data", "ppt-uploads");

export function getPptUploadRoot() {
	return PPT_UPLOAD_ROOT;
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
	const abs = join(PPT_UPLOAD_ROOT, userId, safe);
	assertInsideUploadRoot(abs);
	if (!existsSync(abs)) {
		throw new Error("上传文件不存在或已过期，请重新上传。");
	}
	return abs;
}

export function assertInsideUploadRoot(path: string) {
	const root = PPT_UPLOAD_ROOT.endsWith(sep)
		? PPT_UPLOAD_ROOT
		: `${PPT_UPLOAD_ROOT}${sep}`;
	if (path !== PPT_UPLOAD_ROOT && !path.startsWith(root)) {
		throw new Error("上传文档路径非法。");
	}
}
