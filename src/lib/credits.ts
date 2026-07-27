import { cache } from "react";
import { prisma } from "./db";
import { SETTING_KEYS, DEFAULT_SETTINGS } from "./settings-config";
import {
  cachedJson,
  CACHE_KEYS,
  SETTINGS_CACHE_TTL_SECONDS,
} from "./redis-cache";
import type { CreditTxType, Prisma } from "@prisma/client";

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public balance: number) {
    super("积分不足");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * 全量设置行（含模块开关键）。Setting 表只有几十行，整表读一次即可覆盖
 * 所有 getSetting 调用；配置了 Redis 时跨请求缓存 30s（管理端保存时主动失效），
 * 未配置时行为等同直查数据库。React cache 保证同一请求内只加载一次。
 */
export const getSettingRows = cache((): Promise<Record<string, string>> =>
  cachedJson(CACHE_KEYS.settingsAll, SETTINGS_CACHE_TTL_SECONDS, async () => {
    const rows = await prisma.setting.findMany({
      select: { key: true, value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }),
);

// 读取系统设置；缺失时回退到默认值。
export const getSetting = cache(async (key: string): Promise<string> => {
  const rows = await getSettingRows();
  return rows[key] ?? DEFAULT_SETTINGS[key] ?? "";
});

export async function getSettingNumber(key: string): Promise<number> {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key] ?? 0);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  return { ...DEFAULT_SETTINGS, ...(await getSettingRows()) };
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
