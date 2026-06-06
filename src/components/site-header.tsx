import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordDailyActivity } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";

export async function SiteHeader() {
  const session = await auth();
  const user = session?.user;

  // 积分从数据库读取最新值（session token 里的会过期），保证生成/充值后实时更新
  const credits = user
    ? (
        await Promise.all([
          prisma.user.findUnique({
            where: { id: user.id },
            select: { credits: true },
          }),
          recordDailyActivity(user.id),
        ])
      )[0]?.credits ?? user.credits
    : 0;

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-5" />
          </span>
          AI 聚合站
        </Link>

        <nav className="flex items-center gap-2">
          {user ? (
            <UserMenu
              name={user.name ?? ""}
              email={user.email ?? ""}
              credits={credits}
              isAdmin={user.role === "ADMIN"}
            />
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">登录</Link>
              </Button>
              <Button asChild>
                <Link href="/register">注册</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
