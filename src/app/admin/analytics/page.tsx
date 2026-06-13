import { prisma } from "@/lib/db";
import type { ModuleType } from "@prisma/client";
import { getChinaDayStart, getRecentChinaDayKeys, recordDailyActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "数据看板" };
const SUPPORTED_GENERATION_MODULES: ModuleType[] = ["IMAGE", "VIDEO"];

export default async function AdminAnalyticsPage() {
  const session = await requireAdmin();
  await recordDailyActivity(session.user.id);

  const dayKeys = getRecentChinaDayKeys(7);
  const todayKey = dayKeys[dayKeys.length - 1];
  const today = getChinaDayStart(todayKey);
  const last7 = getChinaDayStart(dayKeys[0]);
  const [
    todayUsers,
    todayGenerations,
    todayOrders,
    dailyActiveRows,
    successGens,
    failedGens,
    creditConsumed,
    creditRecharged,
    popularMaterials,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: today } } }),
    prisma.generation.count({
      where: { module: { in: SUPPORTED_GENERATION_MODULES }, createdAt: { gte: today } },
    }),
    prisma.order.count({ where: { status: "PAID", paidAt: { gte: today } } }),
    prisma.userDailyActivity.groupBy({
      by: ["day"],
      where: { day: { in: dayKeys } },
      _count: { _all: true },
      orderBy: { day: "asc" },
    }),
    prisma.generation.count({
      where: { module: { in: SUPPORTED_GENERATION_MODULES }, createdAt: { gte: last7 }, status: "SUCCESS" },
    }),
    prisma.generation.count({
      where: { module: { in: SUPPORTED_GENERATION_MODULES }, createdAt: { gte: last7 }, status: "FAILED" },
    }),
    prisma.creditTransaction.aggregate({
      where: { createdAt: { gte: last7 }, type: "CONSUME" },
      _sum: { amount: true },
    }),
    prisma.creditTransaction.aggregate({
      where: { createdAt: { gte: last7 }, type: "RECHARGE" },
      _sum: { amount: true },
    }),
    prisma.material.findMany({
      where: { status: "APPROVED", visibility: "PUBLIC" },
      include: { _count: { select: { likes: true, favorites: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ]);
  const activeByDay = new Map(dailyActiveRows.map((row) => [row.day, row._count._all]));
  const todayActive = activeByDay.get(todayKey) ?? 0;
  const averageActive = (
    dayKeys.reduce((sum, day) => sum + (activeByDay.get(day) ?? 0), 0) / dayKeys.length
  ).toFixed(1);
  const maxActive = Math.max(...dayKeys.map((day) => activeByDay.get(day) ?? 0), 1);

  const cards = [
    ["今日日活", todayActive],
    ["7日平均日活", averageActive],
    ["今日注册", todayUsers],
    ["今日生成", todayGenerations],
    ["今日付费订单", todayOrders],
    ["7日成功生成", successGens],
    ["7日失败生成", failedGens],
    ["7日消耗积分", Math.abs(creditConsumed._sum.amount ?? 0)],
    ["7日充值积分", creditRecharged._sum.amount ?? 0],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">数据看板</h1>
        <p className="text-muted-foreground">注册、生成、积分和素材热度概览</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-bold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">近 7 日日活</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dayKeys.map((day) => {
            const value = activeByDay.get(day) ?? 0;
            return (
              <div key={day} className="grid grid-cols-[96px_1fr_48px] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{day.slice(5)}</span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(4, (value / maxActive) * 100)}%` }}
                  />
                </div>
                <span className="text-right font-medium">{value}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">热门公开素材</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {popularMaterials.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm">
              <span className="truncate">{item.title}</span>
              <span className="text-muted-foreground">
                {item._count.likes} 赞 · {item._count.favorites} 收藏
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
