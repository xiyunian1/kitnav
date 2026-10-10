import { auth } from "@/lib/auth";
import { servePptxDownload } from "@/lib/ppt-agent/pptx-download";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return servePptxDownload(session.user.id, id);
}
