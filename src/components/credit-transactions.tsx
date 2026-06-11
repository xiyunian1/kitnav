"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { loadMoreTransactions } from "@/app/(app)/credits/actions";
import { toast } from "sonner";

const TX_LABEL: Record<string, string> = {
  SIGNUP_BONUS: "注册赠送",
  CONSUME: "生成消耗",
  RECHARGE: "充值",
  ADMIN_ADJUST: "管理员调整",
  REFUND: "失败退款",
};

export interface TransactionItem {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface CreditTransactionsProps {
  initialItems: TransactionItem[];
  hasMore: boolean;
}

export function CreditTransactions({ initialItems, hasMore: initialHasMore }: CreditTransactionsProps) {
  const [items, setItems] = useState(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isPending, startTransition] = useTransition();

  function handleLoadMore() {
    const lastId = items[items.length - 1]?.id;
    if (!lastId) return;
    startTransition(async () => {
      try {
        const result = await loadMoreTransactions(lastId);
        if ("error" in result && result.error) {
          toast.error(result.error);
          setHasMore(result.hasMore);
          return;
        }
        setItems((prev) => [...prev, ...result.items]);
        setHasMore(result.hasMore);
      } catch {
        toast.error("加载流水失败，请稍后再试");
      }
    });
  }

  return (
    <div className="divide-y">
      {items.map((tx) => (
        <div
          key={tx.id}
          className="flex items-center justify-between py-3 text-sm"
        >
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="font-normal">
                {TX_LABEL[tx.type] ?? tx.type}
              </Badge>
              {tx.description && (
                <span className="text-muted-foreground">
                  {tx.description}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(tx.createdAt).toLocaleString("zh-CN")}
            </span>
          </div>
          <span
            className={
              tx.amount > 0
                ? "font-medium text-emerald-600 dark:text-emerald-400"
                : "font-medium text-destructive"
            }
          >
            {tx.amount > 0 ? "+" : ""}
            {tx.amount}
          </span>
        </div>
      ))}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={isPending}
          >
            {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            加载更多
          </Button>
        </div>
      )}
    </div>
  );
}
