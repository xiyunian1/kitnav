import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { JSON_BODY_LIMITS, readLimitedJsonBody } from "@/lib/json-request";
import { createPptGeneration } from "@/lib/ppt-agent/generation-request";

export const runtime = "nodejs";

/** 创建一个 PPT 生成任务并入队，实现见 createPptGeneration（MCP 工具共用）。 */
export async function POST(req: NextRequest) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	return createPptGeneration(session.user.id, () =>
		readLimitedJsonBody(req, JSON_BODY_LIMITS.pptGeneration),
	);
}
