"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { AdminNav } from "@/components/admin/admin-sidebar";

// 后台移动端顶栏：仅 <md 显示，含汉堡按钮触发左侧导航抽屉。
export function AdminMobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-sm md:hidden">
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="打开后台导航"
            className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Menu className="size-5" />
          </button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[80vw] flex-col overflow-y-auto border-r bg-sidebar p-4 shadow-lg outline-none",
              "duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
            )}
          >
            <DialogPrimitive.Title className="sr-only">后台导航</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              管理后台导航菜单
            </DialogPrimitive.Description>
            <AdminNav onNavigate={() => setOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <span className="text-base font-bold">管理后台</span>
    </header>
  );
}
