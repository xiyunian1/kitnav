import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import {
	cancelPptGeneration,
	markPptProjectCancelled,
} from "@/lib/ppt-agent/cancellation";
import { appendProjectLog } from "@/lib/ppt-agent/project-log";
import { refundPptProjectCredits } from "@/lib/ppt-agent/refund";
import { isPptProcessingStatus } from "@/lib/ppt-agent/status";

export async function POST(
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
			status: true,
		},
	});

	if (!project) {
		return Response.json({ error: "PPT 项目不存在" }, { status: 404 });
	}

	if (!isPptProcessingStatus(project.status)) {
		return Response.json({
			ok: true,
			status: project.status,
			message: "项目不在生成中",
		});
	}

	const claimed = await markPptProjectCancelled(project.id, session.user.id);
	const aborted = claimed && cancelPptGeneration(project.id);
	if (!claimed) {
		const latest = await prisma.pptProject.findUnique({
			where: { id: project.id },
			select: { status: true },
		});
		return Response.json({
			ok: true,
			aborted,
			refunded: false,
			status: latest?.status ?? project.status,
		});
	}
	await appendProjectLog(project.id, "用户停止生成");
	const refunded = await refundPptProjectCredits(
		project.id,
		`PPT 生成停止退款（${project.id}）`,
	);

	return Response.json({ ok: true, aborted, refunded });
}
