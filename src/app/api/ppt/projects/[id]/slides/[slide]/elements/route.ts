import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  readAnnotatedSvg,
  readSvgEditableElements,
  updateSvgElements,
  type SvgEditableAttribute,
} from "@/lib/ppt-agent/svg-editor";
import { authorizeEditablePptProject } from "../../../../_utils";

export const runtime = "nodejs";

const editableAttrs = [
  "id",
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "fill",
  "stroke",
  "stroke-width",
  "font-size",
  "font-family",
  "font-weight",
  "opacity",
  "transform",
] as const satisfies readonly SvgEditableAttribute[];

const updateSchema = z.object({
  elements: z.array(z.object({
    index: z.number().int().min(0),
    text: z.string().max(2000).optional(),
    attrs: z.record(z.enum(editableAttrs), z.string().max(500).nullable()).optional(),
  })).min(1).max(200),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; slide: string }> }) {
  const authResult = await authorizeProject(params);
  if (authResult instanceof Response) return authResult;

  try {
    return Response.json({
      svg: readAnnotatedSvg(authResult.id, authResult.slide),
      elements: readSvgEditableElements(authResult.id, authResult.slide),
    });
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
    const changed = updateSvgElements(authResult.id, authResult.slide, parsed.elements);
    await prisma.pptProject.update({
      where: { id: authResult.id },
      data: {
        currentPhase: changed > 0 ? "已修改 SVG 元素，等待重新导出" : undefined,
        updatedAt: new Date(),
      },
    });
    return Response.json({
      changed,
      svg: readAnnotatedSvg(authResult.id, authResult.slide),
      elements: readSvgEditableElements(authResult.id, authResult.slide),
    });
  } catch {
    return Response.json({ error: "幻灯片不存在" }, { status: 404 });
  }
}

async function authorizeProject(paramsPromise: Promise<{ id: string; slide: string }>) {
  const { id, slide } = await paramsPromise;
  const project = await authorizeEditablePptProject(Promise.resolve({ id }));
  if (project instanceof Response) return project;
  return { id, slide };
}
