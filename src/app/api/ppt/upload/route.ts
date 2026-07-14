import { basename, extname } from "path";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import {
	savePptUpload,
} from "@/lib/ppt-agent/upload-paths";
import {
	assertValidPptUpload,
	PPT_UPLOAD_EXTENSIONS,
} from "@/lib/ppt-agent/upload-validation";
import {
	enforceUserRequestLimit,
	REQUEST_LIMITS,
} from "@/lib/request-limits";

export const runtime = "nodejs";

const configuredMaxUploadBytes = Number(process.env.PPT_UPLOAD_MAX_BYTES);
const MAX_UPLOAD_BYTES =
	Number.isSafeInteger(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
		? configuredMaxUploadBytes
		: 20 * 1024 * 1024;
export async function POST(req: Request) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		await assertControlledModuleAvailableForUser("ppt", session.user.id);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "PPT 模块不可用" },
			{ status: 403 },
		);
	}

	// 限流：上传写盘 + 可能触发后续转换，防被滥打。
	const limited = await enforceUserRequestLimit(
		session.user.id,
		REQUEST_LIMITS.pptUpload,
	);
	if (limited) return limited;

	const form = await req.formData();
	const file = form.get("file");
	if (!(file instanceof File)) {
		return Response.json({ error: "请选择要上传的文档。" }, { status: 400 });
	}
	if (file.size <= 0) {
		return Response.json({ error: "上传文档为空。" }, { status: 400 });
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		return Response.json(
			{
				error: `文档不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB。`,
			},
			{ status: 413 },
		);
	}

	const ext = extname(file.name).toLowerCase();
	if (!PPT_UPLOAD_EXTENSIONS.has(ext)) {
		return Response.json({ error: "不支持的文档格式。" }, { status: 400 });
	}

	const safeOriginalName = basename(file.name)
		.replace(/[^\p{L}\p{N}._-]+/gu, "_")
		.slice(0, 80);
	const storageName = `${Date.now()}-${randomUUID()}-${safeOriginalName || `source${ext}`}`;
	const buffer = Buffer.from(await file.arrayBuffer());
	try {
		assertValidPptUpload(buffer, ext);
		await savePptUpload(session.user.id, storageName, buffer);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "文件格式无效。" },
			{ status: 400 },
		);
	}
	// 不再返回服务器绝对路径；客户端只拿不透明 token，服务端用 resolveUploadPath 映射回路径。
	return Response.json({
		id: storageName,
		name: file.name,
		size: file.size,
	});
}
