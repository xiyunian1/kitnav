import { prisma } from "@/lib/db";
import { servePptxDownload, verifyPptDownloadSignature } from "@/lib/ppt-agent/pptx-download";

export const runtime = "nodejs";

/** 签名下载链接（由 MCP 的 get_ppt_download 生成，1 小时内有效），无需登录会话。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const expiresAt = Number(url.searchParams.get("exp"));
  const signature = url.searchParams.get("sig") ?? "";
  const project = await prisma.pptProject.findUnique({ where: { id }, select: { userId: true } });
  if (
    !project ||
    !verifyPptDownloadSignature({ projectId: id, ownerId: project.userId, expiresAt, signature })
  ) {
    return Response.json({ error: "下载链接无效或已过期" }, { status: 403 });
  }
  return servePptxDownload(project.userId, id);
}
