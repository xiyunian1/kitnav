import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	assertModule: vi.fn(),
	enforceLimit: vi.fn(),
	retryProject: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/module-controls", () => ({
	assertControlledModuleAvailableForUser: mocks.assertModule,
}));
vi.mock("@/lib/request-limits", () => ({
	enforceUserRequestLimit: mocks.enforceLimit,
	REQUEST_LIMITS: { pptGenerate: { prefix: "ppt-generate" } },
}));
vi.mock("@/lib/logger", () => ({
	logger: { error: mocks.logError },
}));
vi.mock("@/lib/ppt-agent/retry", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/ppt-agent/retry")>();
	return { ...original, retryPptProject: mocks.retryProject };
});

import { PptRetryError } from "@/lib/ppt-agent/retry";
import { POST } from "./route";

describe("PPT retry route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
		mocks.assertModule.mockResolvedValue(undefined);
		mocks.enforceLimit.mockResolvedValue(null);
		mocks.retryProject.mockResolvedValue({
			status: "QUEUED",
			model: "grok-4.5",
			modelSource: "user",
			creditsCharged: 0,
		});
	});

	it("requeues the owned failed project", async () => {
		const response = await requestRetry();

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			status: "QUEUED",
			model: "grok-4.5",
			modelSource: "user",
			creditsCharged: 0,
		});
		expect(mocks.retryProject).toHaveBeenCalledWith("project-1", "user-1");
	});

	it("returns the retry conflict without masking its message", async () => {
		mocks.retryProject.mockRejectedValue(
			new PptRetryError("项目已经在生成中，请勿重复提交。", 409),
		);

		const response = await requestRetry();
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: "项目已经在生成中，请勿重复提交。",
		});
	});

	it("requires authentication before touching the project", async () => {
		mocks.auth.mockResolvedValue(null);

		const response = await requestRetry();
		expect(response.status).toBe(401);
		expect(mocks.retryProject).not.toHaveBeenCalled();
	});
});

function requestRetry() {
	return POST(
		new Request("http://localhost/api/ppt/projects/project-1/retry", {
			method: "POST",
		}),
		{ params: Promise.resolve({ id: "project-1" }) },
	);
}
