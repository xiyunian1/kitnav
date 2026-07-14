import { HardDrive } from "lucide-react";
import type { MaterialStorageUsage } from "@/lib/materials";
import { cn } from "@/lib/utils";

export function MaterialStorageUsageView({
  usage,
  compact = false,
}: {
  usage: MaterialStorageUsage;
  compact?: boolean;
}) {
  const bytePercent =
    usage.maxBytes > 0 ? (usage.usedBytes / usage.maxBytes) * 100 : 0;
  const filePercent =
    usage.maxFiles > 0 ? (usage.fileCount / usage.maxFiles) * 100 : 0;
  const percent = Math.min(100, Math.max(bytePercent, filePercent));
  const barColor =
    percent >= 90
      ? "bg-destructive"
      : percent >= 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  if (compact) {
    return (
      <div
        className="flex min-w-0 items-center gap-2 border px-3 py-1 text-xs text-muted-foreground"
        title={`图片存储 ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.maxBytes)}，${usage.fileCount} / ${usage.maxFiles} 个文件`}
      >
        <HardDrive className="size-3.5 shrink-0" />
        <span className="truncate">
          {formatBytes(usage.usedBytes)} / {formatBytes(usage.maxBytes)}
        </span>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2 border-y py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex shrink-0 items-center gap-2 text-sm font-medium">
        <HardDrive className="size-4" />
        <span>图片存储</span>
      </div>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden bg-muted" aria-hidden="true">
        <div
          className={cn("h-full transition-[width]", barColor)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:justify-end">
        <span>
          {formatBytes(usage.usedBytes)} / {formatBytes(usage.maxBytes)}
        </span>
        <span>
          {usage.fileCount} / {usage.maxFiles} 个文件
        </span>
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
