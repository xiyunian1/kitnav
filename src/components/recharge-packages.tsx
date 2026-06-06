"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, Loader2, Check } from "lucide-react";
import { rechargeAction } from "@/app/(app)/credits/actions";
import type { RechargePackageView } from "@/lib/recharge-packages";

export function RechargePackages({
  packages,
  rechargeEnabled,
}: {
  packages: RechargePackageView[];
  rechargeEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);

  function handleRecharge(id: string) {
    setActiveId(id);
    startTransition(async () => {
      const res = await rechargeAction(id);
      if (res?.error) {
        toast.error(res.error);
      } else if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
      } else {
        toast.success(`充值成功，到账 ${res.credits} 积分`);
        router.refresh();
      }
      setActiveId(null);
    });
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {packages.map((pkg) => {
        const isLoading = pending && activeId === pkg.code;
        return (
          <Card
            key={pkg.id}
            className="relative flex flex-col items-center gap-3 p-5 pt-7 text-center"
          >
            {pkg.popular && (
              <Badge className="absolute right-3 top-3">最受欢迎</Badge>
            )}
            <span className="text-sm text-muted-foreground">{pkg.label}</span>
            <div className="flex items-center gap-1.5 text-2xl font-bold">
              <Coins className="size-5 text-amber-500" />
              {pkg.credits}
            </div>
            <div className="text-lg font-semibold">
              ¥{(pkg.amount / 100).toFixed(0)}
            </div>
            <Button
              className="w-full"
              size="sm"
              onClick={() => handleRecharge(pkg.code)}
              disabled={pending || !rechargeEnabled}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {rechargeEnabled ? "充值" : "暂停充值"}
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
