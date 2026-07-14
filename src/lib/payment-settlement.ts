import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SettlementTransaction = Pick<
  Prisma.TransactionClient,
  "order" | "user" | "creditTransaction"
>;

export interface SettlementDatabase {
  $transaction<T>(callback: (tx: SettlementTransaction) => Promise<T>): Promise<T>;
}

export type PaymentSettlementResult =
  | "settled"
  | "already-settled"
  | "invalid-state";

export interface MockOrderInput {
  userId: string;
  credits: number;
  amount: number;
  description: string;
}

async function grantOrderCredits(
  tx: SettlementTransaction,
  orderId: string,
  description: (credits: number) => string,
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { userId: true, credits: true },
  });
  if (!order) throw new Error("充值订单不存在");

  const updated = await tx.user.update({
    where: { id: order.userId },
    data: { credits: { increment: order.credits } },
  });

  await tx.creditTransaction.create({
    data: {
      userId: order.userId,
      amount: order.credits,
      type: "RECHARGE",
      balanceAfter: updated.credits,
      description: description(order.credits),
    },
  });
}

/** Creates the development-only mock order and grants its credits atomically. */
export async function createSettledMockOrder(
  input: MockOrderInput,
  database: SettlementDatabase = prisma,
) {
  return database.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: input.userId,
        credits: input.credits,
        amount: input.amount,
        status: "PAID",
        provider: "mock",
        paidAt: new Date(),
      },
      select: { id: true },
    });
    await grantOrderCredits(tx, order.id, () => input.description);
    return order.id;
  });
}

/** Atomically claims a pending order before granting credits. */
export async function settleLinuxDoCreditOrder(
  orderId: string,
  database: SettlementDatabase = prisma,
): Promise<PaymentSettlementResult> {
  return database.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({
      where: {
        id: orderId,
        provider: "linuxdo_credit",
        status: "PENDING",
      },
      data: { status: "PAID", paidAt: new Date() },
    });

    if (claimed.count !== 1) {
      const current = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      return current?.status === "PAID" ? "already-settled" : "invalid-state";
    }

    await grantOrderCredits(
      tx,
      orderId,
      (credits) => `Linux.do Credit 充值 ${credits} 积分`,
    );

    return "settled";
  });
}

/** Atomically marks any unpaid order as paid before an administrator grants credits. */
export async function fulfillOrderByAdmin(
  orderId: string,
  database: SettlementDatabase = prisma,
): Promise<"settled" | "already-settled"> {
  return database.$transaction((tx) =>
    fulfillOrderByAdminInTransaction(orderId, tx),
  );
}

export async function fulfillOrderByAdminInTransaction(
  orderId: string,
  tx: SettlementTransaction,
): Promise<"settled" | "already-settled"> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: { not: "PAID" } },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (claimed.count !== 1) {
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!current) throw new Error("订单不存在");
    if (current.status === "PAID") return "already-settled";
    throw new Error("订单状态已变化，请刷新后重试");
  }

  await grantOrderCredits(
    tx,
    orderId,
    () => `管理员补发订单 ${orderId.slice(0, 8)}`,
  );
  return "settled";
}
