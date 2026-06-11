import Link from "next/link";
import { createElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Construction, Lock, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ModuleControlStatus } from "@/lib/module-controls";

interface ModuleUnavailableProps {
  name: string;
  message: string;
  status: ModuleControlStatus;
  icon?: LucideIcon;
}

function statusIcon(status: ModuleControlStatus) {
  if (status === "coming-soon") return Construction;
  if (status === "admin" || status === "hidden") return Lock;
  return PauseCircle;
}

function statusLabel(status: ModuleControlStatus) {
  if (status === "coming-soon") return "即将上线";
  if (status === "admin") return "仅管理员可用";
  if (status === "hidden") return "暂未开放";
  return "模块已暂停";
}

export function ModuleUnavailable({
  name,
  message,
  status,
  icon,
}: ModuleUnavailableProps) {
  const StatusIcon = statusIcon(status);
  const ModuleIcon = icon ?? StatusIcon;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-2xl bg-muted">
        {createElement(ModuleIcon, { className: "size-10 text-muted-foreground" })}
      </div>
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-sm text-muted-foreground">
        {createElement(StatusIcon, { className: "size-3.5" })}
        {statusLabel(status)}
      </div>
      <h1 className="text-2xl font-bold">{name}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">{message}</p>
      <Button className="mt-6" variant="outline" asChild>
        <Link href="/">返回首页</Link>
      </Button>
    </div>
  );
}
