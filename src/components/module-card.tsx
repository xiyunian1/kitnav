import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AppModule } from "@/lib/modules";

export function ModuleCard({ module }: { module: AppModule }) {
  const Icon = module.icon;
  const isActive = module.status === "active";

  const content = (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-6 transition-all",
        isActive
          ? "cursor-pointer hover:border-primary/40 hover:shadow-lg"
          : "opacity-75"
      )}
    >
      <div
        className={cn(
          "mb-4 flex size-12 items-center justify-center rounded-lg bg-gradient-to-br text-white",
          module.accent
        )}
      >
        <Icon className="size-6" />
      </div>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-lg font-semibold">{module.name}</h3>
        {!isActive && (
          <Badge variant="secondary" className="text-xs">
            即将上线
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{module.description}</p>
      {isActive && (
        <span className="mt-4 text-sm font-medium text-primary group-hover:underline">
          立即使用 →
        </span>
      )}
    </div>
  );

  if (isActive) {
    return <Link href={module.href}>{content}</Link>;
  }
  return <div>{content}</div>;
}
