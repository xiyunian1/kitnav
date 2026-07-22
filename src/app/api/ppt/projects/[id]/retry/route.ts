import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import {
	PptRetryError,
	retryPptProject,
} from "@/lib/ppt-agent/retry";
import {
	enforceUserRequestLimit,
	REQUEST_LIMITS,
} from "@/lib/request-limits";

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

	const limited = await enforceUserRequestLimit(
		session.user.id,
		REQUEST_LIMITS.pptGenerate,
	);
	if (limited) return limited;

	const { id } = await params;
	try {
		const result = await retryPptProject(id, session.user.id);
		return Response.json({ ok: true, ...result });
	} catch (error) {
		if (error instanceof PptRetryError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		logger.error("ppt-retry", "PPT 失败项目重试失败", {
			error,
			projectId: id,
			userId: session.user.id,
		});
		return Response.json(
			{ error: "继续生成失败，请稍后重试。" },
			{ status: 500 },
		);
	}
}
