import { prisma } from "./db";
import { SETTING_KEYS, DEFAULT_SETTINGS } from "./settings-config";
import type { CreditTxType } from "@prisma/client";

export class InsufficientCreditsError extends Error {
  constructor(public required: number, public balance: number) {
    super("积分不足");
    this.name = "InsufficientCreditsError";
  }
}

// 读取系统设置；缺失时回退到默认值
export async function getSetting(key: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}

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
  if (amount <= 0) throw new Error("扣减金额必须为正");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("用户不存在");
    if (user.credits < amount) {
      throw new InsufficientCreditsError(amount, user.credits);
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: { decrement: amount } },
    });

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
  });
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
  if (delta === 0) throw new Error("调整值不能为 0");

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("用户不存在");

    const newBalance = user.credits + delta;
    if (newBalance < 0) throw new Error("调整后余额不能为负");

    const updated = await tx.user.update({
      where: { id: userId },
      data: { credits: newBalance },
    });

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
  });
}

export { SETTING_KEYS };
