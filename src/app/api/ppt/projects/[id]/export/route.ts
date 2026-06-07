import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exportPptx, getPptProject } from "@/lib/ppt";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const { id } = await params;
  const project = await getPptProject(session.user.id, id);
  if (!project) return NextResponse.json({ error: "PPT 项目不存在" }, { status: 404 });

  const buffer = await exportPptx(session.user.id, id);
  const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50) || "presentation";
  const fallbackFilename = `${safeTitle.replace(/[^\x20-\x7E]/g, "_")}.pptx`;
  const encodedFilename = encodeURIComponent(`${safeTitle}.pptx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
    },
  });
}
