"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/utils";
import { MODULES } from "@/lib/modules";
import type { SidebarControlState, SidebarModuleState } from "@/lib/module-controls";
import {
  Coins,
  Home,
  Images,
  KeyRound,
  Library,
  MessageSquare,
  User as UserIcon,
} from "lucide-react";

const ACCOUNT_NAV = [
  { key: "materials", name: "素材广场", href: "/materials", icon: Images },
  { key: "library", name: "我的素材库", href: "/library", icon: Library },
  { key: "credits", name: "积分充值", href: "/credits", icon: Coins },
  { key: "settings", name: "API 设置", href: "/settings", icon: KeyRound },
  { key: "feedback", name: "反馈建议", href: "/feedback", icon: MessageSquare },
  { key: "profile", name: "个人资料", href: "/profile", icon: UserIcon },
];

function SidebarNavLink({
  href,
  name,
  icon: Icon,
  badge,
  pathname,
  onNavigate,
}: {
  href: string;
  name: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  const targetHref =
    href === "/feedback"
      ? `/feedback?from=${encodeURIComponent(pathname)}`
      : href;

  return (
    <Link
      href={targetHref}
      onClick={onNavigate}
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

function stateMap(items: SidebarModuleState[]) {
  return new Map(items.map((item) => [item.key, item]));
}

export function SidebarNavClient({
  controls,
  isGuest = false,
  onNavigate,
}: {
  controls: SidebarControlState;
  isGuest?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const moduleState = stateMap(controls.modules);
  const accountState = stateMap(controls.account);

  return (
    <nav aria-label="主导航" className="space-y-1">
      <SidebarNavLink href="/" name="返回首页" icon={Home} pathname={pathname} onNavigate={onNavigate} />
      <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
        AI 工具
      </div>
      {MODULES.flatMap((module) => {
        const state = moduleState.get(module.key);
        if (!state) return [];
        return (
          <SidebarNavLink
            key={module.key}
            href={module.href}
            name={module.name}
            icon={module.icon}
            badge={state.badge}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        );
      })}
      <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-muted-foreground">
        {isGuest ? "展示" : "我的"}
      </div>
      {ACCOUNT_NAV.flatMap((item) => {
        const controlled = ["materials", "library", "credits", "feedback"].includes(item.key);
        const state = controlled ? accountState.get(item.key) : undefined;
        if (controlled && !state) return [];
        return (
          <SidebarNavLink
            key={item.href}
            href={item.href}
            name={
              isGuest && item.key === "library"
                ? "展示素材库"
                : item.name
            }
            icon={item.icon}
            badge={state?.badge}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        );
      })}
    </nav>
  );
}
