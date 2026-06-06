import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RechargePackages } from "@/components/recharge-packages";
import { Coins } from "lucide-react";
import { getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { listRechargePackages } from "@/lib/recharge-packages";

export const metadata = { title: "积分充值" };

const TX_LABEL: Record<string, string> = {
  SIGNUP_BONUS: "注册赠送",
  CONSUME: "生成消耗",
  RECHARGE: "充值",
  ADMIN_ADJUST: "管理员调整",
  REFUND: "失败退款",
};

export default async function CreditsPage() {
  const session = await auth();
  const userId = session!.user.id;

  const [user, transactions, packages, rechargeEnabled] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { credits: true } }),
    prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    listRechargePackages(false),
    getSettingNumber(SETTING_KEYS.CREDITS_RECHARGE_ENABLED),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">积分充值</h1>
        <p className="text-muted-foreground">充值积分，畅享 AI 创作</p>
      </div>

      {/* 当前余额 */}
      <Card className="bg-gradient-to-br from-primary/5 to-primary/10">
        <CardContent className="flex items-center justify-between py-6">
          <div>
            <p className="text-sm text-muted-foreground">当前余额</p>
            <p className="flex items-center gap-2 text-3xl font-bold">
              <Coins className="size-7 text-amber-500" />
              {user?.credits ?? 0}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 充值套餐 */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">选择套餐</h2>
        <RechargePackages packages={packages} rechargeEnabled={rechargeEnabled === 1} />
        <p className="mt-2 text-xs text-muted-foreground">
          * 当前为演示模式，点击充值即时到账，不产生真实扣款
        </p>
      </div>

      {/* 积分流水 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">积分流水</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              暂无流水记录
            </p>
          ) : (
            <div className="divide-y">
              {transactions.map((tx) => (
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
                      {tx.createdAt.toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <span
                    className={
                      tx.amount > 0
                        ? "font-medium text-green-600"
                        : "font-medium text-red-600"
                    }
                  >
                    {tx.amount > 0 ? "+" : ""}
                    {tx.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
