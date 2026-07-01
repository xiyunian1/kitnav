import { mkdir, writeFile } from "fs/promises";
import { basename, extname, join } from "path";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { getPptUploadRoot } from "@/lib/ppt-agent/source-converters";
import { rateLimitCheck, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = Number(
	process.env.PPT_UPLOAD_MAX_BYTES || 20 * 1024 * 1024,
);
const ALLOWED_EXTENSIONS = new Set([
	".pdf",
	".docx",
	".html",
	".htm",
	".epub",
	".ipynb",
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
	".xlsx",
	".xlsm",
]);

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
	const uploadLimit = rateLimitCheck(
		`ppt-upload:u:${session.user.id}`,
		Math.max(1, Number(process.env.PPT_UPLOAD_RATE_MAX || 20)),
		Math.max(1000, Number(process.env.PPT_UPLOAD_RATE_WINDOW_MS || 60_000)),
	);
	if (!uploadLimit.allowed) {
		return rateLimitResponse(uploadLimit, "上传请求过于频繁，请稍后再试。");
	}

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
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		return Response.json({ error: "不支持的文档格式。" }, { status: 400 });
	}

	const safeOriginalName = basename(file.name)
		.replace(/[^\p{L}\p{N}._-]+/gu, "_")
		.slice(0, 80);
	const dir = join(getPptUploadRoot(), session.user.id);
	await mkdir(dir, { recursive: true });
	const storageName = `${Date.now()}-${randomUUID()}-${safeOriginalName || `source${ext}`}`;
	const absolutePath = join(dir, storageName);
	const buffer = Buffer.from(await file.arrayBuffer());
	await writeFile(absolutePath, buffer);

	// 不再返回服务器绝对路径；客户端只拿不透明 token，服务端用 resolveUploadPath 映射回路径。
	return Response.json({
		id: storageName,
		name: file.name,
		size: file.size,
	});
}
