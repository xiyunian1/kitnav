import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	transaction: vi.fn(),
	findUnique: vi.fn(),
	updateMany: vi.fn(),
	userUpdate: vi.fn(),
	createTransaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: { $transaction: mocks.transaction },
}));

import {
	reconcilePptProjectCredits,
	refundPptProjectCredits,
} from "./refund";

describe("refundPptProjectCredits", () => {
	let creditsCost: number;

	beforeEach(() => {
		vi.clearAllMocks();
		creditsCost = 100;
		mocks.findUnique.mockImplementation(async () => ({
			userId: "user-1",
			creditsCost,
			usedOwnKey: false,
		}));
		mocks.updateMany.mockImplementation(async ({ where, data }) => {
			if (creditsCost !== where.creditsCost || creditsCost <= 0) return { count: 0 };
			creditsCost =
				typeof data.creditsCost === "number" ? data.creditsCost : 0;
			return { count: 1 };
		});
		mocks.userUpdate.mockResolvedValue({ credits: 250 });
		mocks.createTransaction.mockResolvedValue({ id: "credit-1" });
		mocks.transaction.mockImplementation(async (callback) =>
			callback({
				pptProject: {
					findUnique: mocks.findUnique,
					updateMany: mocks.updateMany,
				},
				user: { update: mocks.userUpdate },
				creditTransaction: { create: mocks.createTransaction },
			}),
		);
	});

	it("refunds a cancelled project exactly once", async () => {
		await expect(
			refundPptProjectCredits("project-1", "PPT 停止退款"),
		).resolves.toBe(true);
		await expect(
			refundPptProjectCredits("project-1", "PPT 停止退款"),
		).resolves.toBe(false);

		expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
		expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
		expect(mocks.createTransaction).toHaveBeenCalledWith({
			data: expect.objectContaining({
				userId: "user-1",
				amount: 100,
				type: "REFUND",
					balanceAfter: 250,
				}),
			});
	});

	it("reconciles unused image reservations idempotently", async () => {
		await expect(
			reconcilePptProjectCredits(
				"project-1",
				70,
				"PPT 配图未调用额度退款",
				"lease-1",
			),
		).resolves.toBe(30);
		await expect(
			reconcilePptProjectCredits(
				"project-1",
				70,
				"PPT 配图未调用额度退款",
				"lease-1",
			),
		).resolves.toBe(0);

		expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
		expect(mocks.userUpdate).toHaveBeenCalledWith({
			where: { id: "user-1" },
			data: { credits: { increment: 30 } },
		});
		expect(mocks.createTransaction).toHaveBeenCalledWith({
			data: expect.objectContaining({ amount: 30, type: "REFUND" }),
		});
	});
});
