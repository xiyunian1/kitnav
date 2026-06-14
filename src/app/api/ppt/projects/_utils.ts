import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";

const EDITABLE_STATUSES = ["COMPLETED", "FAILED"] as const;

export async function authorizePptProject(paramsPromise: Promise<{ id: string }>) {
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

  const { id } = await paramsPromise;
  const project = await prisma.pptProject.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, title: true, status: true, logs: true, pptxPath: true },
  });
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  return project;
}

export async function authorizeEditablePptProject(paramsPromise: Promise<{ id: string }>) {
  const project = await authorizePptProject(paramsPromise);
  if (project instanceof Response) return project;
  if (!EDITABLE_STATUSES.includes(project.status as (typeof EDITABLE_STATUSES)[number])) {
    return Response.json({ error: "项目生成中，暂不能编辑" }, { status: 409 });
  }
  return project;
}

export function appendProjectLog(logs: string | null | undefined, message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  return [logs, line].filter(Boolean).join("\n");
}
