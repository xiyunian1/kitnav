import { serveFeedbackFile } from "@/lib/feedback-file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, { params }: Context) {
  const { path } = await params;
  return serveFeedbackFile(path.join("/"));
}

export async function HEAD(_request: Request, { params }: Context) {
  const { path } = await params;
  return serveFeedbackFile(path.join("/"), { head: true });
}
