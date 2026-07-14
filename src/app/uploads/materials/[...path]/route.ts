import { serveMaterialFile } from "@/lib/material-file-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

export async function GET(_request: Request, { params }: Context) {
  const { path } = await params;
  return serveMaterialFile(path.join("/"));
}

export async function HEAD(_request: Request, { params }: Context) {
  const { path } = await params;
  return serveMaterialFile(path.join("/"), { head: true });
}
