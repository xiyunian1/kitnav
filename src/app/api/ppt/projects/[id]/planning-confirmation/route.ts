import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";
import { JSON_BODY_LIMITS, jsonRequestErrorDetails, readLimitedJsonBody } from "@/lib/json-request";
import { getPptProjectDir } from "@/lib/ppt-agent/paths";
import {
	assertPptPlanningRecommendations,
	hasPptPlanningDecision,
	markStoredPptPlanningConfirmed,
	markStoredPptPlanningStage,
	readPptPlanningDraft,
	readPptPlanningResult,
	readStoredPptPlanningStage,
	validatePptPlanningDesignSystem,
	validatePptPlanningDirection,
	validatePptPlanningExecution,
	writePptPlanningDecision,
	writePptPlanningDraft,
} from "@/lib/ppt-agent/planning-confirmation";
import { appendProjectLog } from "@/lib/ppt-agent/project-log";
import {
	readPptTemplateFillConfirmation,
	templateFillSubmissionSchema,
	writePptTemplateFillDecision,
} from "@/lib/ppt-agent/template-fill-confirmation";

export const runtime = "nodejs";

interface LockedProject {
	id: string;
	status: string;
	params: string | null;
	slideCount: number;
}

const designSubmissionSchema = z.discriminatedUnion("stage", [
	z.object({
		kind: z.literal("design"),
		stage: z.literal("direction"),
		directionId: z.string().trim().min(1).max(80),
	}),
	z.object({
		kind: z.literal("design"),
		stage: z.literal("design-system"),
		paletteId: z.string().trim().min(1).max(80),
		typographyId: z.string().trim().min(1).max(80),
	}),
	z.object({
		kind: z.literal("design"),
		stage: z.literal("execution"),
		imageStrategyId: z.string().trim().min(1).max(80),
	}),
]);

const confirmationSubmissionSchema = z.union([
	designSubmissionSchema,
	templateFillSubmissionSchema,
]);

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const access = await requirePptUser();
	if (access.response) return access.response;
	const { id } = await params;
	const project = await prisma.pptProject.findFirst({
		where: { id, userId: access.userId },
		select: { id: true, status: true, params: true, slideCount: true },
	});
	if (!project) {
		return Response.json({ error: "PPT 项目不存在" }, { status: 404 });
	}

	try {
		if (hasStoredTemplate(project.params)) {
			return Response.json({
				kind: "template-fill",
				status: project.status,
				templatePlan: readPptTemplateFillConfirmation(
					getPptProjectDir(project.id),
					project.slideCount || 10,
				),
			});
		}
		const recommendations = assertPptPlanningRecommendations(
			getPptProjectDir(project.id),
			{
				expectedSlideCount: project.slideCount || 10,
				allowAiImages: hasStoredImageModel(project.params),
			},
		);
		return Response.json({
			kind: "design",
			status: project.status,
			stage: readStoredPptPlanningStage(project.params),
			recommendations,
			draft:
				readStoredPptPlanningStage(project.params) === "direction"
					? null
					: readPptPlanningDraft(getPptProjectDir(project.id)),
			decision: hasPptPlanningDecision(getPptProjectDir(project.id))
				? readPptPlanningResult(getPptProjectDir(project.id))
				: null,
		});
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : "设计候选不可用" },
			{ status: 409 },
		);
	}
}

export async function POST(
	req: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const access = await requirePptUser();
	if (access.response) return access.response;
	let input: z.infer<typeof confirmationSubmissionSchema>;
	try {
		input = confirmationSubmissionSchema.parse(
			await readLimitedJsonBody(req, JSON_BODY_LIMITS.small),
		);
	} catch (error) {
		const details = jsonRequestErrorDetails(error, "设计方案选择不正确");
		return Response.json(
			{
				error:
					error instanceof z.ZodError
						? error.issues[0]?.message || details.message
						: details.message,
			},
			{ status: details.status },
		);
	}

	const { id } = await params;
	let confirmationLabel = "设计方向";
	try {
		await prisma.$transaction(async (tx) => {
			const rows = await tx.$queryRaw<LockedProject[]>`
				SELECT "id", "status"::text AS "status", "params", "slideCount"
				FROM "PptProject"
				WHERE "id" = ${id} AND "userId" = ${access.userId}
				FOR UPDATE
			`;
			const project = rows[0];
			if (!project) throw new PlanningApiError("PPT 项目不存在", 404);
			if (project.status !== "AWAITING_CONFIRMATION") {
				throw new PlanningApiError("项目当前不在等待方案确认", 409);
			}
			const projectDir = getPptProjectDir(project.id);
			if (hasStoredTemplate(project.params)) {
				if (input.kind !== "template-fill") {
					throw new PlanningApiError("当前项目正在等待模板填充方案确认", 409);
				}
				writePptTemplateFillDecision(projectDir, project.slideCount, input);
				confirmationLabel = "模板页面方案";
				await tx.pptProject.update({
					where: { id: project.id },
					data: {
						params: markStoredPptPlanningConfirmed(project.params),
						status: "QUEUED",
						workerLease: null,
						currentPhase: "模板填充方案已确认，等待继续生成",
						progress: 31,
						error: null,
					},
				});
				return;
			}
			if (input.kind !== "design") {
				throw new PlanningApiError("当前项目正在等待设计方案确认", 409);
			}
			const recommendations = assertPptPlanningRecommendations(projectDir, {
				expectedSlideCount: project.slideCount,
				allowAiImages: hasStoredImageModel(project.params),
			});
			const expectedStage = readStoredPptPlanningStage(project.params);
			if (input.stage !== expectedStage) {
				throw new PlanningApiError("确认阶段已更新，请刷新后重试。", 409);
			}
			let storedParams = project.params;
			let currentPhase = "设计方向已确认，正在推导设计系统";
			if (input.stage === "direction") {
				const directionId = validatePptPlanningDirection(
					recommendations,
					input.directionId,
				);
				writePptPlanningDraft(projectDir, {
					nextStage: "design-system",
					directionId,
				});
				storedParams = markStoredPptPlanningStage(project.params, "design-system");
				confirmationLabel = "设计方向";
			} else if (input.stage === "design-system") {
				const draft = readPptPlanningDraft(projectDir);
				const selected = validatePptPlanningDesignSystem(
					recommendations,
					draft,
					input,
				);
				writePptPlanningDraft(projectDir, {
					nextStage: "execution",
					directionId: draft.directionId,
					...selected,
				});
				storedParams = markStoredPptPlanningStage(project.params, "execution");
				currentPhase = "设计系统已确认，正在推导图片与执行方案";
				confirmationLabel = "设计系统";
			} else {
				const draft = readPptPlanningDraft(projectDir);
				const decision = validatePptPlanningExecution(
					recommendations,
					draft,
					input.imageStrategyId,
				);
				writePptPlanningDecision(projectDir, decision, "user");
				storedParams = markStoredPptPlanningConfirmed(project.params);
				currentPhase = "完整设计方案已确认，等待继续生成";
				confirmationLabel = "图片与执行方案";
			}
			await tx.pptProject.update({
				where: { id: project.id },
				data: {
					params: storedParams,
					status: "QUEUED",
					workerLease: null,
					currentPhase,
					progress: 31,
					error: null,
				},
			});
		});
		await appendProjectLog(id, `用户已确认${confirmationLabel}，原任务重新入队`);
		return Response.json({ ok: true, status: "QUEUED" });
	} catch (error) {
		const status = error instanceof PlanningApiError ? error.status : 409;
		return Response.json(
			{
				error:
					error instanceof Error ? error.message : "确认设计方案失败，请刷新后重试。",
			},
			{ status },
		);
	}
}

async function requirePptUser() {
	const session = await auth();
	if (!session?.user?.id) {
		return {
			userId: "",
			response: Response.json({ error: "Unauthorized" }, { status: 401 }),
		};
	}
	try {
		await assertControlledModuleAvailableForUser("ppt", session.user.id);
		return { userId: session.user.id, response: null };
	} catch (error) {
		return {
			userId: session.user.id,
			response: Response.json(
				{ error: error instanceof Error ? error.message : "PPT 模块不可用" },
				{ status: 403 },
			),
		};
	}
}

function hasStoredImageModel(params: string | null) {
	try {
		const value = params ? JSON.parse(params) : null;
		return Boolean(value && typeof value === "object" && value.imageModel);
	} catch {
		return false;
	}
}

function hasStoredTemplate(params: string | null) {
	try {
		const value = params ? JSON.parse(params) : null;
		return Boolean(
			value &&
				typeof value === "object" &&
				Array.isArray(value.templateFileUrls) &&
				value.templateFileUrls.length > 0,
		);
	} catch {
		return false;
	}
}

class PlanningApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "PlanningApiError";
	}
}
