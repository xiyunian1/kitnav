import Link from "next/link";
import { auth } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { ModuleCard } from "@/components/module-card";
import { Button } from "@/components/ui/button";
import { ImageIcon, Sparkles } from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b bg-[radial-gradient(circle_at_50%_0%,rgba(139,92,246,0.18),transparent_32rem),linear-gradient(to_bottom,var(--color-muted),var(--color-background))]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:text-left">
          <div className="text-center lg:text-left">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-background/80 px-3 py-1 text-sm text-muted-foreground shadow-sm backdrop-blur">
            <Sparkles className="size-3.5 text-primary" />
            一站式 AI 创作平台
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:mx-0">
            用 AI 释放你的创造力
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground lg:mx-0">
            图片生成、视频生成、PPT 生成……所有 AI 工具，一个平台搞定。
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 lg:justify-start">
            {session?.user ? (
              <Button size="lg" asChild>
                <Link href="/image">开始创作</Link>
              </Button>
            ) : (
              <>
                <Button size="lg" asChild>
                  <Link href="/register">免费注册</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">登录</Link>
                </Button>
              </>
            )}
          </div>
          </div>

          <div className="mx-auto hidden w-full max-w-md rounded-xl border bg-background/80 p-4 text-left shadow-xl shadow-violet-500/10 backdrop-blur sm:block">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold">
                <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                  <ImageIcon className="size-4" />
                </span>
                图片生成
              </div>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                已开放
              </span>
            </div>
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="mb-3 h-3 w-2/3 rounded bg-muted-foreground/20" />
              <div className="grid grid-cols-3 gap-2">
                <div className="aspect-square rounded-md bg-gradient-to-br from-violet-500/80 to-purple-600/80" />
                <div className="aspect-square rounded-md bg-gradient-to-br from-sky-400/70 to-cyan-500/80" />
                <div className="aspect-square rounded-md bg-gradient-to-br from-emerald-400/70 to-teal-500/80" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border bg-background px-2 py-1">多图并行</span>
              <span className="rounded-md border bg-background px-2 py-1">素材联动</span>
              <span className="rounded-md border bg-background px-2 py-1">会话历史</span>
            </div>
          </div>
        </div>
      </section>

      {/* 模块网格 */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="mb-2 text-center text-2xl font-bold">全部工具</h2>
        <p className="mb-10 text-center text-muted-foreground">
          选择一个模块，立即开始创作
        </p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <ModuleCard key={m.key} module={m} />
          ))}
        </div>
      </section>
    </>
  );
}
