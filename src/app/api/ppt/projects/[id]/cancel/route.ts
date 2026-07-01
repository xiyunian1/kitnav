import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { cancelPptGeneration } from "@/lib/ppt-agent/cancellation";
import { appendProjectLog } from "@/lib/ppt-agent/project-log";
import { refundPptProjectCredits } from "@/lib/ppt-agent/refund";

const ACTIVE_STATUSES = [
	"PENDING",
	"QUEUED",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
] as const;

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

	if (
		!ACTIVE_STATUSES.includes(
			project.status as (typeof ACTIVE_STATUSES)[number],
		)
	) {
		return Response.json({
			ok: true,
			status: project.status,
			message: "项目不在生成中",
		});
	}

	const aborted = cancelPptGeneration(project.id);
	await prisma.pptProject.update({
		where: { id: project.id },
		data: {
			status: "FAILED",
			currentPhase: "已停止生成",
			error: "用户已停止生成",
		},
	});
	await appendProjectLog(project.id, "用户停止生成");
	const refunded = await refundPptProjectCredits(
		project.id,
		`PPT 生成停止退款（${project.id}）`,
	);

	return Response.json({ ok: true, aborted, refunded });
}
