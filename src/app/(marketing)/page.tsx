import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  ImageIcon,
  Layers,
  Library,
  Presentation,
  Sparkles,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getVisibleMarketingModules } from "@/lib/module-controls";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const highlights = [
  {
    label: "图片生成",
    value: "多图并行 · 会话式迭代",
    icon: ImageIcon,
    tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    label: "PPT 生成",
    value: "文档直出可编辑演示",
    icon: Presentation,
    tone: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  {
    label: "素材广场",
    value: "生成结果沉淀复用",
    icon: Library,
    tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
];

export default async function HomePage() {
  const session = await auth();
  const modules = await getVisibleMarketingModules(session?.user?.role);
  const imageModule = modules.find((module) => module.key === "image");
  const primaryHref = imageModule?.usable ? imageModule.href : "/materials";

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "AI 聚合站",
    url: siteUrl,
    description: "一站式 AI 创作平台：图片生成、素材管理和提示词工作流等",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="border-b bg-muted/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)] lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-background px-3.5 py-1.5 text-sm text-muted-foreground shadow-sm">
              <Sparkles className="size-4 text-primary" />
              AI 聚合站 · 一站式 AI 创作平台
            </div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
              从灵感到成品
              <span className="mt-1.5 block">一个工作台就够了</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              图片生成、PPT 生成、素材库和提示词工作流集中在同一个创作台，少切换工具，更快完成内容生产。
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              {session?.user ? (
                <>
                  <Button size="lg" asChild>
                    <Link href={primaryHref}>
                      开始创作 <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/materials">浏览素材广场</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button size="lg" asChild>
                    <Link href="/register">
                      免费注册 <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link href="/login">登录</Link>
                  </Button>
                </>
              )}
            </div>

            <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-3">
              {highlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-xl border bg-background px-3.5 py-3 shadow-sm"
                  >
                    <span
                      className={cn(
                        "mb-2 inline-flex size-7 items-center justify-center rounded-md",
                        item.tone
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.value}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative">
            <div className="relative overflow-hidden rounded-xl border bg-background shadow-2xl shadow-black/10 ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-rose-400" />
                  <span className="size-2.5 rounded-full bg-amber-400" />
                  <span className="size-2.5 rounded-full bg-emerald-400" />
                </div>
                <Badge variant="secondary">已开放</Badge>
              </div>

              <div className="grid min-h-[360px] grid-cols-[88px_minmax(0,1fr)]">
                <div className="border-r bg-slate-900 p-3 text-white dark:bg-slate-800">
                  <div className="mb-5 flex size-10 items-center justify-center rounded-lg bg-white/10">
                    <Sparkles className="size-5" />
                  </div>
                  <div className="space-y-2">
                    {[
                      [ImageIcon, "图"],
                      [Library, "库"],
                    ].map(([Icon, label], index) => (
                      <div
                        key={String(label)}
                        className={cn(
                          "flex h-10 items-center justify-center rounded-md text-xs",
                          index === 0 ? "bg-white text-slate-900" : "bg-white/10 text-white/70"
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">图片生成工作台</p>
                      <p className="mt-1 text-xs text-muted-foreground">模型、素材、会话记录集中管理</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1 text-xs">
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                      生成完成
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_170px]">
                    <div className="space-y-3">
                      <div className="rounded-lg border bg-muted/50 p-3">
                        <div className="mb-3 h-2.5 w-48 rounded bg-muted-foreground/20" />
                        <div className="grid grid-cols-3 gap-2">
                          <div className="aspect-[4/5] rounded-md bg-[linear-gradient(135deg,#7c3aed,#f472b6)]" />
                          <div className="aspect-[4/5] rounded-md bg-[linear-gradient(135deg,#06b6d4,#22c55e)]" />
                          <div className="aspect-[4/5] rounded-md bg-[linear-gradient(135deg,#f97316,#facc15)]" />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                        <span className="rounded-md border px-2 py-1">标准</span>
                        <span className="rounded-md border px-2 py-1">高清</span>
                        <span className="rounded-md border px-2 py-1">超清</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-lg border p-3">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                          <Layers className="size-4 text-primary" />
                          素材联动
                        </div>
                        <div className="space-y-2">
                          <div className="h-2 rounded bg-muted" />
                          <div className="h-2 w-4/5 rounded bg-muted" />
                          <div className="h-2 w-2/3 rounded bg-muted" />
                        </div>
                      </div>
                      <div className="rounded-lg border p-3">
                        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                          <Clock className="size-4 text-amber-600" />
                          会话历史
                        </div>
                        <div className="space-y-2 text-xs text-muted-foreground">
                          <p className="rounded-md bg-muted/60 px-2 py-1">第 12 轮</p>
                          <p className="rounded-md bg-muted/60 px-2 py-1">第 11 轮</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:py-14">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">全部工具</h2>
            <p className="mt-1 text-muted-foreground">选择一个模块，立即进入对应工作台</p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/materials">
              浏览素材广场 <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon;
            const isActive = module.usable;
            const card = (
              <div
                className={cn(
                  "group flex h-full min-h-40 flex-col rounded-xl border bg-card p-5 transition",
                  isActive
                    ? "shadow-sm hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                    : "border-dashed bg-muted/30"
                )}
              >
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-lg",
                      isActive
                        ? cn("bg-gradient-to-br text-white shadow-sm", module.accent)
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Icon className="size-5" />
                  </div>
                  <Badge variant={isActive ? "default" : "outline"}>
                    {module.badge}
                  </Badge>
                </div>
                <h3
                  className={cn(
                    "text-lg font-semibold transition-colors",
                    isActive ? "group-hover:text-primary" : "text-muted-foreground"
                  )}
                >
                  {module.name}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{module.description}</p>
                {isActive && (
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                    进入工作台 <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
                  </span>
                )}
              </div>
            );

            return isActive ? (
              <Link key={module.key} href={module.href}>
                {card}
              </Link>
            ) : (
              <div key={module.key}>{card}</div>
            );
          })}
        </div>
      </section>
    </>
  );
}
