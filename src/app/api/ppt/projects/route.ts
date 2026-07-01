import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { PPT_USER_FAILURE_MESSAGE } from "@/lib/ppt-agent/status";

export async function GET() {
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

  const projects = await prisma.pptProject.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      sourceType: true,
      status: true,
      progress: true,
      currentPhase: true,
      slideCount: true,
      aspectRatio: true,
      createdAt: true,
      completedAt: true,
      updatedAt: true,
      pptxPath: true,
    },
  });

  return Response.json({
    projects: projects.map((project) => ({
      ...project,
      error: project.status === "FAILED" ? PPT_USER_FAILURE_MESSAGE : null,
    })),
  });
}
