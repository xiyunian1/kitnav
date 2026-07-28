import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasPostgresDatabaseUrl } from "@/lib/database-url";
import { recordDailyActivity } from "@/lib/activity";
import { BRAND_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/user-menu";
import { MobileNav } from "@/components/mobile-nav";
import { getSidebarControlState } from "@/lib/module-controls";
import { isGuestRole } from "@/lib/guest-mode";

export async function SiteHeader({ showMobileNav = false }: { showMobileNav?: boolean }) {
  const session = await auth();
  const user = session?.user;
  const isGuest = isGuestRole(user?.role);

  // 积分从数据库读取最新值（session token 里的会过期），保证生成/充值后实时更新
  let credits = user?.credits ?? 0;
  const sidebarControls = user ? await getSidebarControlState(user.role) : null;
  if (user && !isGuest && hasPostgresDatabaseUrl()) {
    try {
      const [dbUser] = await Promise.all([
        prisma.user.findUnique({
          where: { id: user.id },
          select: { credits: true },
        }),
        recordDailyActivity(user.id),
      ]);
      credits = dbUser?.credits ?? credits;
    } catch {
      credits = user.credits;
    }
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-sm">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-20 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
      >
        跳到主内容
      </a>
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {showMobileNav && user && sidebarControls && (
            <MobileNav controls={sidebarControls} isGuest={isGuest} />
          )}
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            {BRAND_NAME}
          </Link>
        </div>

        <nav aria-label="账户操作" className="flex items-center gap-2">
          {user ? (
            <UserMenu
              name={user.name ?? ""}
              email={user.email ?? ""}
              credits={credits}
              isAdmin={user.role === "ADMIN"}
              isGuest={isGuest}
              controls={sidebarControls}
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
