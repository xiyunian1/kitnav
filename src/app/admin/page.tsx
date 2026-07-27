import { prisma } from "@/lib/db";
import { formatChinaDate } from "@/lib/date-format";
import type { ModuleType } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ImageIcon, ShoppingCart, Coins } from "lucide-react";

export const metadata = { title: "仪表盘" };
const SUPPORTED_GENERATION_MODULES: ModuleType[] = ["IMAGE", "VIDEO"];

export default async function AdminDashboard() {
  const [userCount, genCount, orderAgg, recentUsers, recentGens] =
    await Promise.all([
      prisma.user.count({ where: { role: { not: "GUEST" } } }),
      prisma.generation.count({ where: { module: { in: SUPPORTED_GENERATION_MODULES } } }),
      prisma.order.aggregate({
        where: { status: "PAID" },
        _count: true,
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { role: { not: "GUEST" } },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, email: true, name: true, createdAt: true, credits: true },
      }),
      prisma.generation.findMany({
        where: { module: { in: SUPPORTED_GENERATION_MODULES } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { user: { select: { email: true } } },
      }),
    ]);

  const orderCount = orderAgg._count;
  const revenue = orderAgg._sum.amount ?? 0;

  const stats = [
    { label: "用户总数", value: userCount.toLocaleString("zh-CN"), icon: Users, color: "text-blue-500" },
    { label: "生成总数", value: genCount.toLocaleString("zh-CN"), icon: ImageIcon, color: "text-violet-500" },
    {
      label: "付费订单",
      value: orderCount.toLocaleString("zh-CN"),
      icon: ShoppingCart,
      color: "text-green-500",
    },
    {
      label: "总收入",
      value: (revenue / 100).toLocaleString("zh-CN", { style: "currency", currency: "CNY" }),
      icon: Coins,
      color: "text-amber-500",
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">仪表盘</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label}>
              <CardContent className="flex items-center gap-4 py-5">
                <div className="flex size-11 items-center justify-center rounded-lg bg-muted">
                  <Icon className={`size-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最新注册</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              recentUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{u.name || u.email}</span>
                  <span className="text-muted-foreground">
                    {formatChinaDate(u.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">最新生成</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentGens.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            ) : (
              recentGens.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{g.prompt}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {g.user.email}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
