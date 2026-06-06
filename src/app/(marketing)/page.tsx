import Link from "next/link";
import { auth } from "@/lib/auth";
import { MODULES } from "@/lib/modules";
import { ModuleCard } from "@/components/module-card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export default async function HomePage() {
  const session = await auth();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-muted/50 to-background">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            一站式 AI 创作平台
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            用 AI 释放你的创造力
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            图片生成、视频生成、PPT 生成……所有 AI 工具，一个平台搞定。
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
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
