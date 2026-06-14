import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { readSvgTextNodes, updateSvgTextNodes } from "@/lib/ppt-agent/svg-editor";

export const runtime = "nodejs";

const updateSchema = z.object({
  texts: z.array(z.object({
    index: z.number().int().min(0),
    text: z.string().max(2000),
  })).max(100),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; slide: string }> }) {
  const authResult = await authorizeProject(params);
  if (authResult instanceof Response) return authResult;

  try {
    return Response.json({ texts: readSvgTextNodes(authResult.id, authResult.slide) });
  } catch {
    return Response.json({ error: "幻灯片不存在" }, { status: 404 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; slide: string }> }) {
  const authResult = await authorizeProject(params);
  if (authResult instanceof Response) return authResult;

  let parsed: z.infer<typeof updateSchema>;
  try {
    parsed = updateSchema.parse(await req.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : "请求参数错误";
    return Response.json({ error: message || "请求参数错误" }, { status: 400 });
  }

  try {
    const changed = updateSvgTextNodes(authResult.id, authResult.slide, parsed.texts);
    await prisma.pptProject.update({
      where: { id: authResult.id },
      data: {
        currentPhase: changed > 0 ? "已修改 SVG 文本，等待重新导出" : undefined,
        updatedAt: new Date(),
      },
    });
    return Response.json({ changed });
  } catch {
    return Response.json({ error: "幻灯片不存在" }, { status: 404 });
  }
}

async function authorizeProject(paramsPromise: Promise<{ id: string; slide: string }>) {
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

  const { id, slide } = await paramsPromise;
  const project = await prisma.pptProject.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, status: true },
  });
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  if (project.status !== "COMPLETED" && project.status !== "FAILED") {
    return Response.json({ error: "项目生成中，暂不能编辑" }, { status: 409 });
  }
  return { id, slide };
}
