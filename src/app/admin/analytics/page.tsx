import { prisma } from "@/lib/db";
import type { ModuleType } from "@prisma/client";
import { getChinaDayStart, getRecentChinaDayKeys, recordDailyActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { summarizePptAgentRuns } from "@/lib/ppt-agent/agent-run-metrics";
import {
  AgentPhaseTable,
  AgentUsageTotals,
  formatCost,
  formatDuration,
  formatPercent,
  formatTokens,
  RUN_STATUS_META,
} from "../ppt-projects/agent-run-stats";

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
    prisma.user.count({
      where: { role: { not: "GUEST" }, createdAt: { gte: today } },
    }),
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
  const pptAgent = await loadPptAgentStats();
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
          <CardTitle className="text-base">PPT Agent（近 30 天）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            {pptAgent.headline.map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
          {pptAgent.summary.totals.runs === 0 ? (
            <p className="text-sm text-muted-foreground">近 30 天没有 Agent 运行记录。</p>
          ) : (
            <>
              <AgentUsageTotals totals={pptAgent.summary.totals} />
              <AgentPhaseTable summary={pptAgent.summary} />
              <p className="text-xs text-muted-foreground">
                调用结束状态：
                {Object.entries(pptAgent.summary.statusCounts)
                  .map(([status, count]) => `${RUN_STATUS_META[status]?.label ?? status} ${count}`)
                  .join("，")}
              </p>
            </>
          )}
        </CardContent>
      </Card>
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
                    style={{
                      width: value > 0 ? `${Math.max(4, (value / maxActive) * 100)}%` : "0%",
                    }}
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
          {popularMaterials.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无公开素材数据
            </p>
          ) : (
            popularMaterials.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{item.title}</span>
                <span className="text-muted-foreground">
                  {item._count.likes} 赞 · {item._count.favorites} 收藏
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** PPT 生成的成功率、单份耗时与成本，以及按阶段的用量分布。 */
async function loadPptAgentStats() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [statusRows, completed, runs] = await Promise.all([
    prisma.pptProject.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since }, status: { not: "DRAFT" } },
      _count: { _all: true },
    }),
    prisma.pptProject.aggregate({
      where: { createdAt: { gte: since }, status: { in: ["READY", "COMPLETED"] } },
      _avg: { activeGenerationSeconds: true },
    }),
    prisma.pptAgentRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        projectId: true,
        phase: true,
        status: true,
        llmCalls: true,
        usageReported: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
        cost: true,
        durationMs: true,
      },
    }),
  ]);
  const countOf = (statuses: string[]) =>
    statusRows.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
  const succeeded = countOf(["READY", "COMPLETED"]);
  const failed = countOf(["FAILED"]);
  const total = statusRows.reduce((sum, row) => sum + row._count._all, 0);
  const summary = summarizePptAgentRuns(runs);
  const projectsWithRuns = new Set(runs.map((run) => run.projectId)).size || 1;
  const stuck = (summary.statusCounts.stalled ?? 0) + (summary.statusCounts.timeout ?? 0);
  const headline: [string, string][] = [
    ["项目数 / 成功率", `${total} / ${succeeded + failed ? formatPercent(succeeded / (succeeded + failed)) : "-"}`],
    ["成功项目平均生成时长", formatDuration((completed._avg.activeGenerationSeconds ?? 0) * 1000)],
    ["单个项目平均 token（输入+输出）", formatTokens(Math.round((summary.totals.inputTokens + summary.totals.outputTokens) / projectsWithRuns))],
    ["单个项目平均费用", formatCost(summary.totals.cost / projectsWithRuns)],
    ["超时或无进展终止", summary.totals.runs ? `${stuck} 次（${formatPercent(stuck / summary.totals.runs)}）` : "-"],
  ];
  return { summary, headline };
}
