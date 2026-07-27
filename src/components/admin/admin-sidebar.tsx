"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BarChart3,
  ImageIcon,
  Images,
  KeyRound,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Presentation,
  Users,
} from "lucide-react";

const NAV = [
  { name: "仪表盘", href: "/admin", icon: LayoutDashboard },
  { name: "数据看板", href: "/admin/analytics", icon: BarChart3 },
  { name: "用户管理", href: "/admin/users", icon: Users },
  { name: "生成记录", href: "/admin/generations", icon: ImageIcon },
  { name: "PPT 记录", href: "/admin/ppt-projects", icon: Presentation },
  { name: "素材管理", href: "/admin/materials", icon: Images },
  { name: "用户反馈", href: "/admin/feedback", icon: MessageSquare },
  { name: "充值订单", href: "/admin/orders", icon: ShoppingCart },
  { name: "API 配置", href: "/admin/api-config", icon: KeyRound },
  { name: "运营控制", href: "/admin/operations", icon: ShieldCheck },
  { name: "模块控制", href: "/admin/modules", icon: SlidersHorizontal },
  { name: "公告管理", href: "/admin/announcements", icon: Megaphone },
  { name: "审计日志", href: "/admin/audit-logs", icon: ScrollText },
  { name: "系统设置", href: "/admin/settings", icon: Settings },
];

// 后台导航项列表，桌面侧边栏与移动端抽屉共用。
export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <Link
        href="/"
        onClick={onNavigate}
        className="mb-4 flex items-center gap-2 px-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        返回前台
      </Link>
      <div className="mb-2 px-3 text-lg font-bold">管理后台</div>
      <nav className="space-y-1">
        {NAV.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export function AdminSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-4 md:sticky md:top-0 md:block md:h-dvh md:overflow-y-auto">
      <AdminNav />
    </aside>
  );
}
