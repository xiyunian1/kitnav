import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { adjustCreditsInTransaction } from "./credits";

function transaction(options: { claimed: number; credits?: number }) {
  return {
    user: {
      updateMany: vi.fn(async () => ({ count: options.claimed })),
      findUnique: vi.fn(async () =>
        options.credits === undefined ? null : { credits: options.credits },
      ),
    },
    creditTransaction: {
      create: vi.fn(async () => ({ id: "transaction-1" })),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("adjustCreditsInTransaction", () => {
  it("uses an atomic increment and records the resulting balance", async () => {
    const tx = transaction({ claimed: 1, credits: 125 });

    await expect(
      adjustCreditsInTransaction(tx, "user-1", 25, "manual"),
    ).resolves.toBe(125);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { credits: { increment: 25 } },
    });
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 25, balanceAfter: 125 }),
    });
  });

  it("guards an atomic decrement against a negative balance", async () => {
    const tx = transaction({ claimed: 1, credits: 60 });

    await expect(
      adjustCreditsInTransaction(tx, "user-1", -40),
    ).resolves.toBe(60);
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", credits: { gte: 40 } },
      data: { credits: { decrement: 40 } },
    });
  });

  it("does not write a transaction when funds are insufficient", async () => {
    const tx = transaction({ claimed: 0, credits: 20 });

    await expect(
      adjustCreditsInTransaction(tx, "user-1", -40),
    ).rejects.toThrow("调整后余额不能为负");
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });
});
