import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getLinuxDoCreditConfig,
  verifyLinuxDoCreditParams,
} from "@/lib/linuxdo-credit";

function text(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const config = getLinuxDoCreditConfig();

  if (!config.pid || !config.key) return text("missing merchant config", 500);
  if (params.pid !== config.pid) return text("invalid pid", 400);
  if (!verifyLinuxDoCreditParams(params, config.key)) return text("invalid sign", 400);
  if (params.trade_status !== "TRADE_SUCCESS") return text("ignored", 400);

  const orderId = params.out_trade_no;
  if (!orderId) return text("missing out_trade_no", 400);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.provider !== "linuxdo_credit") return text("order not found", 404);

  const expectedMoney = (order.amount / 100).toFixed(2);
  const actualMoney = Number(params.money).toFixed(2);
  if (actualMoney !== expectedMoney) return text("invalid money", 400);

  if (order.status === "PAID") return text("success");

  await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUnique({ where: { id: order.id } });
    if (!current || current.status === "PAID") return;

    const updated = await tx.user.update({
      where: { id: current.userId },
      data: { credits: { increment: current.credits } },
    });

    await tx.order.update({
      where: { id: current.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await tx.creditTransaction.create({
      data: {
        userId: current.userId,
        amount: current.credits,
        type: "RECHARGE",
        balanceAfter: updated.credits,
        description: `Linux.do Credit 充值 ${current.credits} 积分`,
      },
    });
  });

  return text("success");
}
