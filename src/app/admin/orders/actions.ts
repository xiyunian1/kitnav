"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveAdminId } from "@/lib/admin-guard";
import { runAuditedAdminTransaction } from "@/lib/audit";
import { fulfillOrderByAdminInTransaction } from "@/lib/payment-settlement";

async function guard() {
  const adminId = await getActiveAdminId();
  if (!adminId) throw new Error("无权限");
  return adminId;
}

const orderIdSchema = z.string().min(1).max(100);

export async function markOrderFailedAction(orderId: string) {
  const adminId = await guard();
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { error: "参数错误" };
  const updated = await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.order.updateMany({
        where: { id: parsed.data, status: { not: "PAID" } },
        data: { status: "FAILED" },
      }),
    (result) =>
      result.count === 1
        ? { action: "order.failed", target: parsed.data }
        : null,
  );
  if (updated.count !== 1) return { error: "已支付订单不能标记为失败" };
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function cancelOrderAction(orderId: string) {
  const adminId = await guard();
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { error: "参数错误" };
  const updated = await runAuditedAdminTransaction(
    adminId,
    (tx) =>
      tx.order.updateMany({
        where: { id: parsed.data, status: { not: "PAID" } },
        data: { status: "CANCELED" },
      }),
    (result) =>
      result.count === 1
        ? { action: "order.canceled", target: parsed.data }
        : null,
  );
  if (updated.count !== 1) return { error: "已支付订单不能取消" };
  revalidatePath("/admin/orders");
  return { ok: true };
}

export async function fulfillOrderAction(orderId: string) {
  const adminId = await guard();
  const parsed = orderIdSchema.safeParse(orderId);
  if (!parsed.success) return { error: "参数错误" };
  const result = await runAuditedAdminTransaction(
    adminId,
    (tx) => fulfillOrderByAdminInTransaction(parsed.data, tx),
    (settlement) => ({
      action: "order.fulfill",
      target: parsed.data,
      detail: { result: settlement },
    }),
  );
  revalidatePath("/admin/orders");
  revalidatePath("/admin/users");
  return { ok: true, settled: result === "settled" };
}
