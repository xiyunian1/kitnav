import { rm } from "node:fs/promises";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import {
	getPptUserFailureMessage,
	PPT_PROCESSING_STATUSES,
} from "@/lib/ppt-agent/status";
import { hasPptxArtifact } from "@/lib/ppt-agent/project-public";

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
			error: true,
			pptxPath: true,
			slideCount: true,
			aspectRatio: true,
			creditsCost: true,
			createdAt: true,
			completedAt: true,
			artifactsDeletedAt: true,
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
		error:
			project.status === "FAILED"
				? getPptUserFailureMessage(project.error)
				: null,
		hasPptx: hasPptxArtifact(project),
		slideCount: project.slideCount,
		aspectRatio: project.aspectRatio,
		creditsCost: project.creditsCost,
		createdAt: project.createdAt,
		completedAt: project.completedAt,
		artifactsDeletedAt: project.artifactsDeletedAt,
		updatedAt: project.updatedAt,
	});
}

export async function DELETE(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { id } = await params;
	const project = await prisma.pptProject.findFirst({
		where: { id, userId: session.user.id },
		select: { id: true, status: true },
	});
	if (!project) {
		return Response.json({ error: "PPT 项目不存在" }, { status: 404 });
	}
	if ((PPT_PROCESSING_STATUSES as readonly string[]).includes(project.status)) {
		return Response.json(
			{ error: "请先停止生成，再删除该项目。" },
			{ status: 409 },
		);
	}

	const deleted = await prisma.pptProject.deleteMany({
		where: {
			id,
			userId: session.user.id,
			status: { notIn: [...PPT_PROCESSING_STATUSES] },
		},
	});
	if (deleted.count !== 1) {
		return Response.json(
			{ error: "项目状态已更新，请刷新后重试。" },
			{ status: 409 },
		);
	}

	await rm(getPptProjectDir(id), { recursive: true, force: true }).catch(
		() => undefined,
	);
	return Response.json({ ok: true });
}
