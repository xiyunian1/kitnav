import { auth } from "@/lib/auth";
import { requireModulePageAccess, getStaticModuleMeta } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { prisma } from "@/lib/db";
import { resolvePptAgentBillingMode } from "@/lib/ppt-agent/billing";
import { PptWorkbench } from "./components/workbench";
import { Badge } from "@/components/ui/badge";
import { Clock3, Coins, KeyRound, LayoutDashboard } from "lucide-react";

export const metadata = { title: "PPT 生成" };

export default async function PptPage() {
  const session = await auth();
  const access = await requireModulePageAccess("ppt");

  if (!access.usable) {
    const meta = getStaticModuleMeta("ppt");
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
        icon={meta?.icon}
      />
    );
  }

  const [recentProjects, billingMode] = await Promise.all([
    prisma.pptProject.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        progress: true,
        currentPhase: true,
        slideCount: true,
        createdAt: true,
        completedAt: true,
        updatedAt: true,
        pptxPath: true,
      },
    }),
    resolvePptAgentBillingMode(session!.user.id),
  ]);

  const creditsPerSlide = Number(process.env.PPT_CREDITS_PER_SLIDE || 10);

  const stats = [
    {
      label: "最近项目",
      value: recentProjects.length,
      icon: Clock3,
    },
    {
      label: "单页成本",
      value: billingMode.useOwnKey ? "0" : creditsPerSlide,
      icon: Coins,
    },
    {
      label: "运行模式",
      value: billingMode.useOwnKey ? "自带 API" : "积分",
      icon: billingMode.useOwnKey ? KeyRound : LayoutDashboard,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="flex flex-col gap-4 border-b pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">PPT 工作台</h1>
            <Badge variant="secondary">{billingMode.useOwnKey ? "自带 API" : "积分计费"}</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            把 brief、资料、模板和视觉方向放在一个任务里，生成可编辑 PPTX。
          </p>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-3 xl:min-w-[420px]">
          {stats.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border bg-card px-3 py-2.5 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <Icon className="size-3.5" />
                  <p>{item.label}</p>
                </div>
                <p className="truncate font-semibold">{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      <PptWorkbench
        recentProjects={recentProjects}
        useOwnKey={billingMode.useOwnKey}
        creditsPerSlide={creditsPerSlide}
      />
    </div>
  );
}
