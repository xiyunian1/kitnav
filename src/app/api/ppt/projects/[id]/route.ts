import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";

export const runtime = "nodejs";

const LOG_TAIL_LINES = 6;

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
			error: true,
			logs: true,
			pptxPath: true,
			slideCount: true,
			aspectRatio: true,
			creditsCost: true,
			completedAt: true,
			updatedAt: true,
		},
	});

	if (!project) {
		return Response.json({ error: "PPT 项目不存在" }, { status: 404 });
	}

	const logs = project.logs ? project.logs.split("\n").filter(Boolean) : [];

	return Response.json({
		id: project.id,
		title: project.title,
		status: project.status,
		progress: project.progress,
		currentPhase: project.currentPhase,
		error: project.error,
		// 只返回最近几行用于实时进度展示；完整日志在项目详情页查看。
		recentLogs: logs.slice(-LOG_TAIL_LINES),
		logCount: logs.length,
		pptxPath: project.pptxPath,
		slideCount: project.slideCount,
		aspectRatio: project.aspectRatio,
		creditsCost: project.creditsCost,
		completedAt: project.completedAt,
		updatedAt: project.updatedAt,
	});
}
