import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	assertModule: vi.fn(),
	transaction: vi.fn(),
	queryRaw: vi.fn(),
	update: vi.fn(),
	assertRecommendations: vi.fn(),
	validateDecision: vi.fn(),
	writeDecision: vi.fn(),
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
		validatePptPlanningDecision: mocks.validateDecision,
		writePptPlanningDecision: mocks.writeDecision,
		markStoredPptPlanningConfirmed: mocks.markConfirmed,
	};
});

import { POST } from "./route";

const pagePlan = Array.from({ length: 3 }, (_, index) => ({
	page: index + 1,
	title: `第 ${index + 1} 页`,
	purpose: `第 ${index + 1} 页内容目标`,
	rhythm: index === 1 ? ("dense" as const) : ("anchor" as const),
	layoutFamily: index === 0 ? "hero" : "comparison",
}));

const decision = {
	directionId: "direction-1",
	paletteId: "palette-1",
	typographyId: "type-1",
	imageStrategyId: "images-1",
	pagePlan,
};

describe("PPT planning confirmation route", () => {
	let status: string;

	beforeEach(() => {
		vi.clearAllMocks();
		status = "AWAITING_CONFIRMATION";
		mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
		mocks.assertModule.mockResolvedValue(undefined);
		mocks.assertRecommendations.mockReturnValue({ id: "recommendations" });
		mocks.validateDecision.mockReturnValue(decision);
		mocks.markConfirmed.mockReturnValue(
			JSON.stringify({ confirmDesign: true, planningConfirmed: true }),
		);
		mocks.queryRaw.mockImplementation(async () => [
			{
				id: "project-1",
				status,
				params: JSON.stringify({ confirmDesign: true }),
				slideCount: 3,
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

	it("stores the complete edited design and requeues once", async () => {
		const response = await confirmDesignRequest();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, status: "QUEUED" });
		expect(mocks.validateDecision).toHaveBeenCalledWith(
			{ id: "recommendations" },
			expect.objectContaining({ kind: "design", pagePlan }),
		);
		expect(mocks.writeDecision).toHaveBeenCalledWith(
			expect.any(String),
			decision,
			"user",
		);
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "project-1" },
			data: expect.objectContaining({
				status: "QUEUED",
				workerLease: null,
				params: expect.stringContaining('"planningConfirmed":true'),
				currentPhase: "完整设计方案已确认，等待继续生成",
			}),
		});
		expect(mocks.appendLog).toHaveBeenCalledWith(
			"project-1",
			"用户已确认完整设计方案，原任务重新入队",
		);
	});

	it("rejects a duplicate confirmation after the first request requeues it", async () => {
		expect((await confirmDesignRequest()).status).toBe(200);
		const duplicate = await confirmDesignRequest();

		expect(duplicate.status).toBe(409);
		expect(await duplicate.json()).toMatchObject({
			error: "项目当前不在等待方案确认",
		});
		expect(mocks.writeDecision).toHaveBeenCalledTimes(1);
		expect(mocks.update).toHaveBeenCalledTimes(1);
	});

	it("rejects a partial design selection before opening a transaction", async () => {
		const response = await POST(
			new Request(
				"http://localhost/api/ppt/projects/project-1/planning-confirmation",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						kind: "design",
						directionId: "direction-1",
					}),
				},
			),
			{ params: Promise.resolve({ id: "project-1" }) },
		);

		expect(response.status).toBe(400);
		expect(mocks.transaction).not.toHaveBeenCalled();
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

function confirmDesignRequest() {
	return POST(
		new Request("http://localhost/api/ppt/projects/project-1/planning-confirmation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "design", ...decision }),
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
