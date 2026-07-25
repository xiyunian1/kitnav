"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Coins,
  Images,
  KeyRound,
  LayoutDashboard,
  Library,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  ScanEye,
  Sun,
  User as UserIcon,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import type { SidebarControlState } from "@/lib/module-controls";

interface UserMenuProps {
  name: string;
  email: string;
  credits: number;
  isAdmin: boolean;
  isGuest: boolean;
  controls: SidebarControlState | null;
}

export function UserMenu({
  name,
  email,
  credits,
  isAdmin,
  isGuest,
  controls,
}: UserMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const initial = (name || email).charAt(0).toUpperCase();
  const feedbackHref = `/feedback?from=${encodeURIComponent(pathname)}`;
  const accountState = new Map((controls?.account ?? []).map((item) => [item.key, item]));
  const showMaterials = accountState.has("materials");
  const showLibrary = accountState.has("library");
  const showCredits = accountState.has("credits");
  const showFeedback = accountState.has("feedback");

  async function handleSignOut() {
    await signOut({ redirect: false });
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {isGuest ? (
        <span className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
          <ScanEye className="size-4" />
          游客
        </span>
      ) : (
        <Link
          href="/credits"
          className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted/70"
        >
          <Coins className="size-4 text-amber-500" />
          {credits}
        </Link>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="outline-none" aria-label="打开用户菜单">
            <Avatar className="size-9 cursor-pointer">
              <AvatarFallback className="bg-primary text-primary-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">
                {isGuest ? "游客参观" : name || "用户"}
              </span>
              {!isGuest && (
                <span className="text-xs font-normal text-muted-foreground">{email}</span>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {showMaterials && (
            <DropdownMenuItem asChild>
              <Link href="/materials">
                <Images className="size-4" /> 素材广场
              </Link>
            </DropdownMenuItem>
          )}
          {showLibrary && (
            <DropdownMenuItem asChild>
              <Link href="/library">
                <Library className="size-4" /> 我的素材库
              </Link>
            </DropdownMenuItem>
          )}
          {showCredits && !isGuest && (
            <DropdownMenuItem asChild>
              <Link href="/credits">
                <Coins className="size-4" /> 积分充值
              </Link>
            </DropdownMenuItem>
          )}
          {!isGuest && (
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <KeyRound className="size-4" /> API 设置
              </Link>
            </DropdownMenuItem>
          )}
          {showFeedback && !isGuest && (
            <DropdownMenuItem asChild>
              <Link href={feedbackHref}>
                <MessageSquare className="size-4" /> 反馈建议
              </Link>
            </DropdownMenuItem>
          )}
          {!isGuest && (
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <UserIcon className="size-4" /> 个人资料
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setTheme(isDark ? "light" : "dark")}>
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {isDark ? "切换为亮色" : "切换为暗色"}
          </DropdownMenuItem>
          {theme !== "system" && (
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="size-4" /> 跟随系统
            </DropdownMenuItem>
          )}
          {isAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/admin">
                  <LayoutDashboard className="size-4" /> 管理后台
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut} variant="destructive">
            <LogOut className="size-4" /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
