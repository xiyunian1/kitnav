import { describe, expect, it, vi } from "vitest";
import {
  createSettledMockOrder,
  fulfillOrderByAdmin,
  settleLinuxDoCreditOrder,
  type SettlementDatabase,
} from "./payment-settlement";

function createDatabase(options: {
  claimed: number;
  status?: "PENDING" | "PAID" | "FAILED";
}) {
  const tx = {
    order: {
      create: vi.fn(async () => ({ id: "order-1" })),
      updateMany: vi.fn(async () => ({ count: options.claimed })),
      findUnique: vi.fn(async (args: { select?: { status?: boolean } }) =>
        args.select?.status
          ? { status: options.status ?? "PENDING" }
          : { userId: "user-1", credits: 50 },
      ),
    },
    user: {
      update: vi.fn(async () => ({ credits: 125 })),
    },
    creditTransaction: {
      create: vi.fn(async () => ({ id: "tx-1" })),
    },
  };
  const database = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as SettlementDatabase;
  return { database, tx };
}

describe("createSettledMockOrder", () => {
  it("creates the paid order and grants credits in one transaction", async () => {
    const { database, tx } = createDatabase({ claimed: 0 });

    await expect(
      createSettledMockOrder(
        {
          userId: "user-1",
          credits: 50,
          amount: 100,
          description: "充值 体验包",
        },
        database,
      ),
    ).resolves.toBe("order-1");

    expect(tx.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        credits: 50,
        amount: 100,
        status: "PAID",
        provider: "mock",
      }),
      select: { id: true },
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 50,
        description: "充值 体验包",
      }),
    });
  });
});

describe("settleLinuxDoCreditOrder", () => {
  it("grants credits only after atomically claiming a pending order", async () => {
    const { database, tx } = createDatabase({ claimed: 1 });

    await expect(settleLinuxDoCreditOrder("order-1", database)).resolves.toBe(
      "settled",
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "order-1",
          provider: "linuxdo_credit",
          status: "PENDING",
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 50, balanceAfter: 125 }),
    });
  });

  it("treats duplicate callbacks as successful without granting credits again", async () => {
    const { database, tx } = createDatabase({ claimed: 0, status: "PAID" });

    await expect(settleLinuxDoCreditOrder("order-1", database)).resolves.toBe(
      "already-settled",
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("rejects callbacks for orders in a non-payable state", async () => {
    const { database, tx } = createDatabase({ claimed: 0, status: "FAILED" });

    await expect(settleLinuxDoCreditOrder("order-1", database)).resolves.toBe(
      "invalid-state",
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

describe("fulfillOrderByAdmin", () => {
  it("atomically claims an unpaid order before granting credits", async () => {
    const { database, tx } = createDatabase({ claimed: 1, status: "FAILED" });

    await expect(fulfillOrderByAdmin("order-1", database)).resolves.toBe(
      "settled",
    );
    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-1", status: { not: "PAID" } },
      }),
    );
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.creditTransaction.create).toHaveBeenCalledTimes(1);
  });

  it("does not grant credits when another request already fulfilled the order", async () => {
    const { database, tx } = createDatabase({ claimed: 0, status: "PAID" });

    await expect(fulfillOrderByAdmin("order-1", database)).resolves.toBe(
      "already-settled",
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.creditTransaction.create).not.toHaveBeenCalled();
  });
});
