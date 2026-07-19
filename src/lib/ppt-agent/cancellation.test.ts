import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { pptProject: { updateMany: dbMocks.updateMany } },
}));

import {
  abortAllPptGenerationsForShutdown,
  isPptGenerationCancelled,
  isPptWorkerShutdown,
	markPptProjectCancelled,
  registerPptGeneration,
  throwIfPptCancelled,
} from "./cancellation";

describe("PPT worker shutdown cancellation", () => {
	beforeEach(() => {
		dbMocks.updateMany.mockReset();
	});

  it("aborts active jobs with a restart-specific reason", () => {
    const controller = new AbortController();
    const unregister = registerPptGeneration("project-1", controller);

    expect(abortAllPptGenerationsForShutdown()).toContain("project-1");
    expect(controller.signal.aborted).toBe(true);
    expect(() => throwIfPptCancelled(controller.signal)).toThrow("worker 正在重启");
    try {
      throwIfPptCancelled(controller.signal);
    } catch (error) {
      expect(isPptWorkerShutdown(error)).toBe(true);
      expect(isPptGenerationCancelled(error)).toBe(false);
    }
    unregister();
  });

	it("allows an awaiting-confirmation project to be cancelled atomically", async () => {
		dbMocks.updateMany.mockResolvedValue({ count: 1 });

		await expect(markPptProjectCancelled("project-1", "user-1")).resolves.toBe(
			true,
		);
		expect(dbMocks.updateMany).toHaveBeenCalledWith({
			where: {
				id: "project-1",
				userId: "user-1",
				status: expect.objectContaining({
					in: expect.arrayContaining(["AWAITING_CONFIRMATION"]),
				}),
			},
			data: expect.objectContaining({
				status: "FAILED",
				workerLease: null,
			}),
		});
	});
});
