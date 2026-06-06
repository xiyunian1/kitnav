"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";

async function guard() {
  if (!(await isAdmin())) throw new Error("无权限");
}

export async function markOrderFailedAction(orderId: string) {
  await guard();
  await prisma.order.update({ where: { id: orderId }, data: { status: "FAILED" } });
  await writeAuditLog({ action: "order.failed", target: orderId });
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function cancelOrderAction(orderId: string) {
  await guard();
  await prisma.order.update({ where: { id: orderId }, data: { status: "CANCELED" } });
  await writeAuditLog({ action: "order.canceled", target: orderId });
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function fulfillOrderAction(orderId: string) {
  await guard();
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("订单不存在");
    if (order.status === "PAID") return;
    const user = await tx.user.update({
      where: { id: order.userId },
      data: { credits: { increment: order.credits } },
    });
    await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paidAt: new Date() },
    });
    await tx.creditTransaction.create({
      data: {
        userId: order.userId,
        amount: order.credits,
        type: "RECHARGE",
        balanceAfter: user.credits,
        description: `管理员补发订单 ${order.id.slice(0, 8)}`,
      },
    });
  });
  await writeAuditLog({ action: "order.fulfill", target: orderId });
  revalidatePath("/admin/orders");
  revalidatePath("/admin/users");
  return { ok: true };
}
