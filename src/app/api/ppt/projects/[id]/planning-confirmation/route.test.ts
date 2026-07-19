import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	assertModule: vi.fn(),
	transaction: vi.fn(),
	queryRaw: vi.fn(),
	update: vi.fn(),
	assertRecommendations: vi.fn(),
	validateDirection: vi.fn(),
	validateExecution: vi.fn(),
	readDraft: vi.fn(),
	readStage: vi.fn(),
	writeDraft: vi.fn(),
	writeDecision: vi.fn(),
	markStage: vi.fn(),
	markConfirmed: vi.fn(),
	writeTemplateDecision: vi.fn(),
	appendLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/module-controls", () => ({
	assertControlledModuleAvailableForUser: mocks.assertModule,
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		$transaction: mocks.transaction,
	},
}));
vi.mock("@/lib/ppt-agent/project-log", () => ({
	appendProjectLog: mocks.appendLog,
}));
vi.mock("@/lib/ppt-agent/template-fill-confirmation", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("@/lib/ppt-agent/template-fill-confirmation")
	>();
	return {
		...original,
		writePptTemplateFillDecision: mocks.writeTemplateDecision,
	};
});
vi.mock("@/lib/ppt-agent/planning-confirmation", async (importOriginal) => {
	const original = await importOriginal<
		typeof import("@/lib/ppt-agent/planning-confirmation")
	>();
	return {
		...original,
		assertPptPlanningRecommendations: mocks.assertRecommendations,
		hasPptPlanningDecision: vi.fn(() => false),
		readPptPlanningResult: vi.fn(),
		validatePptPlanningDirection: mocks.validateDirection,
		validatePptPlanningExecution: mocks.validateExecution,
		readPptPlanningDraft: mocks.readDraft,
		readStoredPptPlanningStage: mocks.readStage,
		writePptPlanningDraft: mocks.writeDraft,
		writePptPlanningDecision: mocks.writeDecision,
		markStoredPptPlanningStage: mocks.markStage,
		markStoredPptPlanningConfirmed: mocks.markConfirmed,
	};
});

import { POST } from "./route";

const decision = {
	directionId: "direction-1",
	paletteId: "palette-1",
	typographyId: "type-1",
	imageStrategyId: "images-1",
};

describe("PPT planning confirmation route", () => {
	let status: string;

	beforeEach(() => {
		vi.clearAllMocks();
		status = "AWAITING_CONFIRMATION";
		mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
		mocks.assertModule.mockResolvedValue(undefined);
		mocks.assertRecommendations.mockReturnValue({ directions: [] });
		mocks.validateDirection.mockReturnValue("direction-1");
		mocks.validateExecution.mockReturnValue(decision);
		mocks.readDraft.mockReturnValue({
			nextStage: "execution",
			directionId: "direction-1",
			paletteId: "palette-1",
			typographyId: "type-1",
		});
		mocks.readStage.mockImplementation((params: string) => {
			const parsed = JSON.parse(params);
			return parsed.planningConfirmationStage || "direction";
		});
		mocks.markStage.mockReturnValue(
			JSON.stringify({
				confirmDesign: true,
				planningConfirmed: false,
				planningConfirmationStage: "design-system",
			}),
		);
		mocks.markConfirmed.mockReturnValue(
			JSON.stringify({ confirmDesign: true, planningConfirmed: true }),
		);
		mocks.queryRaw.mockImplementation(async () => [
			{
				id: "project-1",
				status,
				params: JSON.stringify({ confirmDesign: true }),
				slideCount: 10,
			},
		]);
		mocks.update.mockImplementation(async ({ data }) => {
			status = data.status;
			return { id: "project-1" };
		});
		mocks.transaction.mockImplementation(async (callback) =>
			callback({
				$queryRaw: mocks.queryRaw,
				pptProject: { update: mocks.update },
			}),
		);
	});

		it("stores the direction draft and requeues the same project without charging again", async () => {
			const response = await confirmRequest();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, status: "QUEUED" });
			expect(mocks.writeDraft).toHaveBeenCalledWith(expect.any(String), {
				nextStage: "design-system",
				directionId: "direction-1",
			});
			expect(mocks.writeDecision).not.toHaveBeenCalled();
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "project-1" },
			data: expect.objectContaining({
				status: "QUEUED",
				workerLease: null,
					params: expect.stringContaining(
						'"planningConfirmationStage":"design-system"',
					),
			}),
		});
		expect(mocks.appendLog).toHaveBeenCalledWith(
			"project-1",
				"用户已确认设计方向，原任务重新入队",
		);
	});

	it("rejects a duplicate confirmation after the first request requeues it", async () => {
		expect((await confirmRequest()).status).toBe(200);
		const duplicate = await confirmRequest();

		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
				error: "项目当前不在等待方案确认",
			});
			expect(mocks.writeDraft).toHaveBeenCalledTimes(1);
			expect(mocks.update).toHaveBeenCalledTimes(1);
		});

		it("writes the final decision only at the execution stage", async () => {
			mocks.queryRaw.mockImplementation(async () => [
				{
					id: "project-1",
					status,
					params: JSON.stringify({
						confirmDesign: true,
						planningConfirmationStage: "execution",
					}),
					slideCount: 10,
				},
			]);
			const response = await confirmExecutionRequest();

			expect(response.status).toBe(200);
			expect(mocks.writeDecision).toHaveBeenCalledWith(
				expect.any(String),
				decision,
				"user",
			);
			expect(mocks.update).toHaveBeenCalledWith({
				where: { id: "project-1" },
				data: expect.objectContaining({
					params: expect.stringContaining('"planningConfirmed":true'),
				}),
			});
		});

		it("stores a native template page mapping before resuming apply", async () => {
			mocks.queryRaw.mockImplementation(async () => [
				{
					id: "project-1",
					status,
					params: JSON.stringify({
						confirmDesign: true,
						templateFileUrls: ["/uploads/template.pptx"],
					}),
					slideCount: 2,
				},
			]);
			const input = {
				kind: "template-fill" as const,
				slides: [
					{ planIndex: 2, sourceSlide: 4 },
					{ planIndex: 1, sourceSlide: 2 },
				],
			};
			const response = await confirmTemplateRequest(input);

			expect(response.status).toBe(200);
			expect(mocks.writeTemplateDecision).toHaveBeenCalledWith(
				expect.any(String),
				2,
				input,
			);
			expect(mocks.appendLog).toHaveBeenCalledWith(
				"project-1",
				"用户已确认模板页面方案，原任务重新入队",
			);
		});
});

function confirmRequest() {
	return POST(
		new Request("http://localhost/api/ppt/projects/project-1/planning-confirmation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
				kind: "design",
				stage: "direction",
				directionId: "direction-1",
			}),
		}),
		{ params: Promise.resolve({ id: "project-1" }) },
	);
}

function confirmExecutionRequest() {
	return POST(
		new Request("http://localhost/api/ppt/projects/project-1/planning-confirmation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "design",
				stage: "execution",
				imageStrategyId: "images-1",
			}),
		}),
		{ params: Promise.resolve({ id: "project-1" }) },
	);
}

function confirmTemplateRequest(input: {
	kind: "template-fill";
	slides: Array<{ planIndex: number; sourceSlide: number }>;
}) {
	return POST(
		new Request("http://localhost/api/ppt/projects/project-1/planning-confirmation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}),
		{ params: Promise.resolve({ id: "project-1" }) },
	);
}
