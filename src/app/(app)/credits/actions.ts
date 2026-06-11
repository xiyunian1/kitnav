"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { addCredits, getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { getRechargePackage } from "@/lib/recharge-packages";
import {
  createLinuxDoCreditPayment,
  getRechargeProvider,
} from "@/lib/linuxdo-credit";
import { assertControlledModuleAvailableForUser } from "@/lib/module-controls";

async function getRequestOrigin() {
  const configured = process.env.APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";

  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// Mock 充值：直接创建已支付订单并发放积分。
// 真实接入时，这里应改为创建 PENDING 订单 → 跳支付网关 → 回调中发放积分。
export async function loadMoreTransactions(cursor: string, take = 20) {
  const session = await auth();
  if (!session?.user) return { items: [], hasMore: false };
  const pageSize = Math.min(Math.max(take, 1), 50);

  try {
    const cursorTx = await prisma.creditTransaction.findFirst({
      where: { id: cursor, userId: session.user.id },
      select: { id: true },
    });

    if (!cursorTx) {
      return { items: [], hasMore: false, error: "流水记录已更新，请刷新后重试" };
    }

    const items = await prisma.creditTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      cursor: { id: cursor },
      skip: 1,
    });

    const hasMore = items.length > pageSize;
    if (hasMore) items.pop();

    return {
      items: items.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        createdAt: tx.createdAt.toISOString(),
      })),
      hasMore,
    };
  } catch {
    return { items: [], hasMore: false, error: "加载流水失败，请稍后再试" };
  }
}

export async function rechargeAction(packageId: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: "请先登录" };
  }
  try {
    await assertControlledModuleAvailableForUser("credits", session.user.id);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "积分充值已暂停" };
  }

  const enabled = await getSettingNumber(SETTING_KEYS.CREDITS_RECHARGE_ENABLED);
  if (enabled !== 1) return { error: "积分充值已暂停" };

  const pkg = await getRechargePackage(packageId);
  if (!pkg) {
    return { error: "套餐不存在" };
  }

  const userId = session.user.id;
  const provider = getRechargeProvider();

  if (provider === "linuxdo_credit") {
    const order = await prisma.order.create({
      data: {
        userId,
        credits: pkg.credits,
        amount: pkg.amount,
        status: "PENDING",
        provider,
      },
    });

    try {
      const origin = await getRequestOrigin();
      const paymentUrl = await createLinuxDoCreditPayment({
        outTradeNo: order.id,
        name: `${pkg.label} ${pkg.credits} 积分`,
        money: (pkg.amount / 100).toFixed(2),
        notifyUrl: `${origin}/api/payments/linuxdo-credit/notify`,
        returnUrl: `${origin}/credits?order=${order.id}`,
      });

      revalidatePath("/credits");
      return { ok: true, paymentUrl };
    } catch (error) {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "FAILED" },
      });
      return {
        error: error instanceof Error ? error.message : "Linux.do Credit 创建订单失败",
      };
    }
  }

  // 创建订单（Mock：直接标记为已支付）
  await prisma.order.create({
    data: {
      userId,
      credits: pkg.credits,
      amount: pkg.amount,
      status: "PAID",
      provider: "mock",
      paidAt: new Date(),
    },
  });

  // 发放积分
  await addCredits(userId, pkg.credits, "RECHARGE", `充值 ${pkg.label}`);

  revalidatePath("/credits");
  return { ok: true, credits: pkg.credits };
}
