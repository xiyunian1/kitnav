import { mkdir, writeFile } from "fs/promises";
import { basename, extname } from "path";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { getPptUploadRoot } from "@/lib/ppt-agent/source-converters";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = Number(process.env.PPT_UPLOAD_MAX_BYTES || 20 * 1024 * 1024);
const pathJoin = (...parts: string[]) => {
  const path = eval("require")("path") as typeof import("path");
  return path.join(...parts);
};
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
      { status: 403 }
    );
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
    return Response.json({ error: `文档不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB。` }, { status: 413 });
  }

  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return Response.json({ error: "不支持的文档格式。" }, { status: 400 });
  }

  const safeOriginalName = basename(file.name).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80);
  const dir = pathJoin(getPptUploadRoot(), session.user.id);
  await mkdir(dir, { recursive: true });
  const storageName = `${Date.now()}-${randomUUID()}-${safeOriginalName || `source${ext}`}`;
  const absolutePath = pathJoin(dir, storageName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, buffer);

  return Response.json({
    path: absolutePath,
    name: file.name,
    size: file.size,
  });
}
