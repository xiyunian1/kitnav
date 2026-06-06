"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  cancelOrderAction,
  fulfillOrderAction,
  markOrderFailedAction,
} from "@/app/admin/orders/actions";

export function OrderActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok?: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(message);
        router.refresh();
      }
    });
  }

  if (status === "PAID") return null;
  return (
    <div className="flex justify-end gap-1">
      {pending && <Loader2 className="size-4 animate-spin" />}
      <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => fulfillOrderAction(id), "已补发")}>
        补发
      </Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => markOrderFailedAction(id), "已标记失败")}>
        失败
      </Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => cancelOrderAction(id), "已取消")}>
        取消
      </Button>
    </div>
  );
}
