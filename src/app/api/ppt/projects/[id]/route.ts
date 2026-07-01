import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { PPT_USER_FAILURE_MESSAGE } from "@/lib/ppt-agent/status";

export const runtime = "nodejs";

/**
 * 返回单个 PPT 项目的状态快照，供前端轮询生成进度。
 * 替代原 SSE 流：前端在生成期间定时轮询本端点，依据 status 推进 UI。
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	try {
		await assertControlledModuleAvailableForUser("ppt", session.user.id);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "PPT 模块不可用" },
			{ status: 403 },
		);
	}

	const { id } = await params;
	const project = await prisma.pptProject.findFirst({
		where: { id, userId: session.user.id },
		select: {
			id: true,
			title: true,
			status: true,
			progress: true,
			currentPhase: true,
			pptxPath: true,
			slideCount: true,
			aspectRatio: true,
			creditsCost: true,
			createdAt: true,
			completedAt: true,
			updatedAt: true,
		},
	});

	if (!project) {
		return Response.json({ error: "PPT 项目不存在" }, { status: 404 });
	}

	return Response.json({
		id: project.id,
		title: project.title,
		status: project.status,
		progress: project.progress,
		currentPhase: project.currentPhase,
		error: project.status === "FAILED" ? PPT_USER_FAILURE_MESSAGE : null,
		pptxPath: project.pptxPath,
		slideCount: project.slideCount,
		aspectRatio: project.aspectRatio,
		creditsCost: project.creditsCost,
		createdAt: project.createdAt,
		completedAt: project.completedAt,
		updatedAt: project.updatedAt,
	});
}
