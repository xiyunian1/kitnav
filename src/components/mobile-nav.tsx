"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { SidebarNav } from "@/components/app-sidebar";

// 移动端导航抽屉：汉堡按钮触发，从左侧滑出，复用用户区侧边栏导航项。
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="打开导航菜单"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col gap-2 overflow-y-auto border-r bg-sidebar p-4 shadow-lg outline-none",
            "duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
          )}
        >
          <DialogPrimitive.Title className="px-3 pb-2 text-lg font-bold">
            AI 聚合站
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            站点导航菜单
          </DialogPrimitive.Description>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
