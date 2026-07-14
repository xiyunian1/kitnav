import { cache } from "react";
import { prisma } from "./db";
import { SETTING_KEYS, DEFAULT_SETTINGS } from "./settings-config";
import type { CreditTxType, Prisma } from "@prisma/client";

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public balance: number) {
    super("积分不足");
    this.name = "InsufficientCreditsError";
  }
}

// 读取系统设置；缺失时回退到默认值。React cache 保证同一请求渲染内同 key 只查一次。
export const getSetting = cache(async (key: string): Promise<string> => {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
});

export async function getSettingNumber(key: string): Promise<number> {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key] ?? 0);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) map[r.key] = r.value;
  return map;
}

// 扣减积分：事务内校验余额 → 扣减 → 写流水。余额不足抛 InsufficientCreditsError。
// 返回扣减后余额。
export async function consumeCredits(
  userId: string,
  amount: number,
  description?: string
): Promise<number> {
  return prisma.$transaction((tx) =>
    consumeCreditsInTransaction(tx, userId, amount, description)
  );
}

export async function consumeCreditsInTransaction(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
  amount: number,
  description?: string
): Promise<number> {
  if (amount <= 0) throw new Error("扣减金额必须为正");

  const claimed = await tx.user.updateMany({
    where: { id: userId, credits: { gte: amount } },
    data: { credits: { decrement: amount } },
  });
  if (claimed.count !== 1) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new Error("用户不存在");
    throw new InsufficientCreditsError(amount, user.credits);
  }

  const updated = await tx.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  if (!updated) throw new Error("用户不存在");

  await tx.creditTransaction.create({
    data: {
      userId,
      amount: -amount,
      type: "CONSUME",
      balanceAfter: updated.credits,
      description,
    },
  });

  return updated.credits;
}

// 增加积分：用于注册赠送、充值、管理员调整、退款。返回增加后余额。
export async function addCredits(
  userId: string,
  amount: number,
  type: CreditTxType,
  description?: string
): Promise<number> {
  if (amount <= 0) throw new Error("增加金额必须为正");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount,
        type,
        balanceAfter: updated.credits,
        description,
      },
    });

    return updated.credits;
  });
}

// 管理员调整：可正可负，记为 ADMIN_ADJUST。负向调整不允许把余额扣成负数。
export async function adjustCredits(
  userId: string,
  delta: number,
  description?: string
): Promise<number> {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error("调整值必须是非零整数");
  }

  return prisma.$transaction((tx) =>
    adjustCreditsInTransaction(tx, userId, delta, description),
  );
}

export async function adjustCreditsInTransaction(
  tx: Prisma.TransactionClient | typeof prisma,
  userId: string,
  delta: number,
  description?: string,
) {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error("调整值必须是非零整数");
  }
  const amount = Math.abs(delta);
  const claimed = await tx.user.updateMany({
    where:
      delta > 0
        ? { id: userId }
        : { id: userId, credits: { gte: amount } },
    data:
      delta > 0
        ? { credits: { increment: amount } }
        : { credits: { decrement: amount } },
  });
  if (claimed.count !== 1) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });
    if (!user) throw new Error("用户不存在");
    throw new Error("调整后余额不能为负");
  }

  const updated = await tx.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  if (!updated) throw new Error("用户不存在");
  await tx.creditTransaction.create({
    data: {
      userId,
      amount: delta,
      type: "ADMIN_ADJUST",
      balanceAfter: updated.credits,
      description: description ?? "管理员调整",
    },
  });
  return updated.credits;
}

export { SETTING_KEYS };
