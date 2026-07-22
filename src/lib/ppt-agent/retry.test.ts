import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findSnapshot: vi.fn(),
	transaction: vi.fn(),
	findLockedProject: vi.fn(),
	updateMany: vi.fn(),
	lockUser: vi.fn(),
	resolveTextMode: vi.fn(),
	resolveImageProvider: vi.fn(),
	checkCapacity: vi.fn(),
	acquireStorageLock: vi.fn(),
	consumeCredits: vi.fn(),
	getSettingNumber: vi.fn(),
	appendLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		pptProject: { findFirst: mocks.findSnapshot },
		$transaction: mocks.transaction,
	},
}));
vi.mock("@/lib/credits", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/credits")>();
	return {
		...original,
		consumeCreditsInTransaction: mocks.consumeCredits,
		getSettingNumber: mocks.getSettingNumber,
	};
});
vi.mock("@/lib/logger", () => ({ onError: () => () => undefined }));
vi.mock("@/lib/providers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/providers")>();
	return { ...original, resolveImageProvider: mocks.resolveImageProvider };
});
vi.mock("@/lib/queue-capacity", () => ({
	checkPptQueueCapacity: mocks.checkCapacity,
}));
vi.mock("@/lib/ppt-agent/billing", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/ppt-agent/billing")>();
	return {
		...original,
		getPptCreditsPerSlide: () => 10,
		resolvePptAgentBillingMode: mocks.resolveTextMode,
	};
});
vi.mock("@/lib/ppt-agent/storage-lock", () => ({
	tryAcquirePptStorageReferenceLock: mocks.acquireStorageLock,
}));
vi.mock("@/lib/ppt-agent/project-log", () => ({
	appendProjectLog: mocks.appendLog,
}));

import { ProviderConfigInvalidError } from "@/lib/providers";
import {
	canRetryPptProject,
	PptRetryError,
	retryPptProject,
} from "./retry";

describe("retryPptProject", () => {
	let snapshot: ReturnType<typeof projectSnapshot>;
	let lockedProject: ReturnType<typeof projectSnapshot>;

	beforeEach(() => {
		vi.clearAllMocks();
		snapshot = projectSnapshot();
		lockedProject = projectSnapshot();
		mocks.findSnapshot.mockImplementation(async () => snapshot);
		mocks.findLockedProject.mockImplementation(async ({ where }) =>
			typeof where.id === "string" ? lockedProject : null,
		);
		mocks.updateMany.mockResolvedValue({ count: 1 });
		mocks.lockUser.mockResolvedValue([{ id: "user-1" }]);
		mocks.resolveTextMode.mockResolvedValue({
			useOwnKey: true,
			source: "user",
			defaultModel: "grok-4.5",
			supportsVision: false,
			models: ["grok-4.5"],
		});
		mocks.checkCapacity.mockResolvedValue({
			allowed: true,
			pending: 0,
			maxPending: 30,
		});
		mocks.acquireStorageLock.mockResolvedValue(true);
		mocks.consumeCredits.mockResolvedValue(100);
		mocks.getSettingNumber.mockResolvedValue(3);
		mocks.appendLog.mockResolvedValue(undefined);
		mocks.transaction.mockImplementation(async (callback) =>
			callback({
				$queryRaw: mocks.lockUser,
				pptProject: {
					findFirst: mocks.findLockedProject,
					updateMany: mocks.updateMany,
				},
			}),
		);
	});

	it("requeues with the exact saved user model and preserves confirmed planning", async () => {
		await expect(retryPptProject("project-1", "user-1")).resolves.toEqual({
			status: "QUEUED",
			model: "grok-4.5",
			modelSource: "user",
			creditsCharged: 0,
		});

		expect(mocks.resolveTextMode).toHaveBeenCalledWith("user-1", {
			model: "grok-4.5",
			source: "user",
		});
		expect(mocks.consumeCredits).not.toHaveBeenCalled();
		expect(mocks.lockUser).toHaveBeenCalledTimes(1);
		expect(mocks.lockUser.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.findLockedProject.mock.invocationCallOrder[1],
		);
		const update = mocks.updateMany.mock.calls[0]?.[0];
		const stored = JSON.parse(update.data.params);
		expect(stored).toMatchObject({
			model: "grok-4.5",
			modelSource: "user",
			planningConfirmed: true,
			retryAttempt: 1,
		});
		expect(update.data).toMatchObject({
			status: "QUEUED",
			creditsCost: 0,
			usedOwnKey: true,
			error: null,
		});
		expect(mocks.appendLog).toHaveBeenCalledWith(
			"project-1",
			expect.stringContaining("保持原模型 grok-4.5"),
		);
	});

	it("recharges a refunded platform task once before requeueing", async () => {
		const params = storedParams({ modelSource: "platform" });
		snapshot = projectSnapshot({ params, usedOwnKey: false });
		lockedProject = projectSnapshot({ params, usedOwnKey: false });
		mocks.resolveTextMode.mockResolvedValue({
			useOwnKey: false,
			source: "platform",
			defaultModel: "grok-4.5",
			supportsVision: false,
			models: ["grok-4.5"],
		});

		await expect(retryPptProject("project-1", "user-1")).resolves.toMatchObject({
			creditsCharged: 100,
			modelSource: "platform",
		});
		expect(mocks.consumeCredits).toHaveBeenCalledTimes(1);
		expect(mocks.consumeCredits).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			100,
			expect.stringContaining("继续生成预扣费"),
		);
		expect(mocks.updateMany.mock.calls[0]?.[0].data).toMatchObject({
			creditsCost: 100,
			usedOwnKey: false,
		});
	});

	it("reserves image credits using the original image model and source", async () => {
		const params = storedParams({
			modelSource: "platform",
			imageModel: "gpt-image-2",
			imageModelSource: "platform",
			imageCountLimit: 4,
		});
		snapshot = projectSnapshot({ params, usedOwnKey: false });
		lockedProject = projectSnapshot({ params, usedOwnKey: false });
		mocks.resolveTextMode.mockResolvedValue({
			useOwnKey: false,
			source: "platform",
			defaultModel: "grok-4.5",
			supportsVision: false,
			models: ["grok-4.5"],
		});
		mocks.resolveImageProvider.mockResolvedValue({
			model: "gpt-image-2",
			source: "platform",
			creditCostOverride: null,
		});

		await expect(retryPptProject("project-1", "user-1")).resolves.toMatchObject({
			creditsCharged: 112,
		});
		expect(mocks.resolveImageProvider).toHaveBeenCalledWith(
			"user-1",
			"IMAGE",
			"gpt-image-2",
			"platform",
		);
		expect(mocks.consumeCredits).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			112,
			expect.any(String),
		);
	});

	it("does not fall back when the saved model is unavailable", async () => {
		mocks.resolveTextMode.mockRejectedValue(
			new ProviderConfigInvalidError("所选模型未保存或已停用"),
		);

		await expect(retryPptProject("project-1", "user-1")).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("grok-4.5"),
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("does not infer an API source when the saved source is missing", async () => {
		const params = storedParams({ modelSource: undefined });
		snapshot = projectSnapshot({ params, usedOwnKey: true });

		await expect(retryPptProject("project-1", "user-1")).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("模型来源不完整"),
		});
		expect(mocks.resolveTextMode).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("rejects duplicate retries after the project has already requeued", async () => {
		lockedProject = projectSnapshot({ status: "QUEUED" });

		await expect(retryPptProject("project-1", "user-1")).rejects.toMatchObject({
			status: 409,
			message: "项目已经在生成中，请勿重复提交。",
		});
		expect(mocks.consumeCredits).not.toHaveBeenCalled();
		expect(mocks.updateMany).not.toHaveBeenCalled();
	});

	it("waits for an unfinished refund instead of charging twice", async () => {
		lockedProject = projectSnapshot({ creditsCost: 100 });

		await expect(retryPptProject("project-1", "user-1")).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("积分正在退回"),
		});
		expect(mocks.consumeCredits).not.toHaveBeenCalled();
	});

	it("does not offer retry for a user-cancelled or cleaned project", async () => {
		expect(
			canRetryPptProject({
				status: "FAILED",
				error: "用户已停止生成",
				params: "{}",
			}),
		).toBe(false);
		expect(
			canRetryPptProject({
				status: "FAILED",
				error: "upstream failed",
				artifactsDeletedAt: new Date(),
				params: "{}",
			}),
		).toBe(false);
		expect(
			canRetryPptProject({
				status: "FAILED",
				error: "upstream failed",
				params: "{}",
			}),
		).toBe(true);
		expect(
			canRetryPptProject({
				status: "FAILED",
				error: "upstream failed",
				params: null,
			}),
		).toBe(false);

		snapshot = projectSnapshot({ error: "用户已停止生成" });
		await expect(retryPptProject("project-1", "user-1")).rejects.toBeInstanceOf(
			PptRetryError,
		);
		expect(mocks.resolveTextMode).not.toHaveBeenCalled();
	});
});

function projectSnapshot(
	overrides: Partial<{
		status: string;
		error: string | null;
		artifactsDeletedAt: Date | null;
		params: string | null;
		model: string | null;
		slideCount: number | null;
		usedOwnKey: boolean;
		creditsCost: number;
	}> = {},
) {
	return {
		id: "project-1",
		status: "FAILED",
		error: "PPT Master agent 调用模型失败：503 no available channels",
		artifactsDeletedAt: null,
		params: storedParams(),
		model: "grok-4.5",
		slideCount: 10,
		usedOwnKey: true,
		creditsCost: 0,
		...overrides,
	};
}

function storedParams(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		sourceType: "markdown",
		model: "grok-4.5",
		modelSource: "user",
		slideCount: 10,
		confirmDesign: true,
		planningConfirmed: true,
		...overrides,
	});
}
