import { auth } from "@/lib/auth";
import { JSON_BODY_LIMITS, readLimitedJsonBody } from "@/lib/json-request";
import {
	getPptPlanningConfirmation,
	submitPptPlanningConfirmation,
} from "@/lib/ppt-agent/planning-confirmation-request";

export const runtime = "nodejs";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	return getPptPlanningConfirmation(session.user.id, id);
}

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const { id } = await params;
	return submitPptPlanningConfirmation(session.user.id, id, () =>
		readLimitedJsonBody(req, JSON_BODY_LIMITS.standard),
	);
}
