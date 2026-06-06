"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { MODULES } from "@/lib/modules";
import { Coins, User as UserIcon, Home, KeyRound, Images, Library } from "lucide-react";

const ACCOUNT_NAV = [
  { name: "素材广场", href: "/materials", icon: Images },
  { name: "我的素材库", href: "/library", icon: Library },
  { name: "积分充值", href: "/credits", icon: Coins },
  { name: "API 设置", href: "/settings", icon: KeyRound },
  { name: "个人资料", href: "/profile", icon: UserIcon },
];

function SidebarNavLink({
  href,
  name,
  icon: Icon,
  badge,
  pathname,
}: {
  href: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  pathname: string;
}) {
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon className="size-4" />
      <span className="flex-1">{name}</span>
      {badge && (
        <span className="rounded bg-muted-foreground/20 px-1.5 py-0.5 text-[10px]">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-4 md:block">
      <nav className="space-y-1">
        <SidebarNavLink href="/" name="返回首页" icon={Home} pathname={pathname} />
        <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
          AI 工具
        </div>
        {MODULES.map((m) => (
          <SidebarNavLink
            key={m.key}
            href={m.href}
            name={m.name}
            icon={m.icon}
            badge={m.status === "coming-soon" ? "soon" : undefined}
            pathname={pathname}
          />
        ))}
        <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
          我的
        </div>
        {ACCOUNT_NAV.map((item) => (
          <SidebarNavLink key={item.href} {...item} pathname={pathname} />
        ))}
      </nav>
    </aside>
  );
}
