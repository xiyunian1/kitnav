"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Download, Clock, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { CancelProjectButton } from "./cancel-project-button";
import {
  isPptProcessingStatus,
  PPT_USER_FAILURE_MESSAGE,
} from "@/lib/ppt-agent/status";
import { formatProjectDurationLabel } from "./duration";

export interface ProjectListItem {
  id: string;
  title: string;
  sourceType: string;
  status: string;
  progress: number;
  currentPhase?: string | null;
  slideCount: number | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
  updatedAt?: Date | string;
  pptxPath: string | null;
  error?: string | null;
}

interface Props {
  projects: ProjectListItem[];
  compact?: boolean;
}

const STATUS_MAP = {
  PENDING: { label: "等待中", icon: Clock, className: "border-slate-200 bg-slate-50 text-slate-700" },
  QUEUED: { label: "排队中", icon: Clock, className: "border-blue-200 bg-blue-50 text-blue-700" },
  STRATEGIZING: { label: "规划中", icon: Loader2, className: "border-purple-200 bg-purple-50 text-purple-700" },
  ACQUIRING_IMAGES: { label: "采集素材", icon: Loader2, className: "border-amber-200 bg-amber-50 text-amber-700" },
  EXECUTING: { label: "生成中", icon: Loader2, className: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  EXPORTING: { label: "导出中", icon: Loader2, className: "border-cyan-200 bg-cyan-50 text-cyan-700" },
  COMPLETED: { label: "已完成", icon: CheckCircle2, className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  FAILED: { label: "失败", icon: XCircle, className: "border-red-200 bg-red-50 text-red-700" },
} as const;

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelativeTime(value?: Date | string) {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "刚刚更新";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  return formatTime(value);
}

function sourceTypeLabel(value: string) {
  if (value === "TOPIC") return "主题";
  if (value === "MARKDOWN") return "Markdown";
  if (value === "URL") return "网页";
  if (value === "DOCUMENT") return "文档";
  return value;
}

export function ProjectList({ projects, compact = false }: Props) {
  const router = useRouter();
  const [polledItems, setPolledItems] = useState<ProjectListItem[] | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const items = polledItems ?? projects;
  const statusRef = useRef(new Map(projects.map((item) => [item.id, item.status])));
  const hasProcessingProject = useMemo(
    () => items.some((project) => isPptProcessingStatus(project.status)),
    [items],
  );

  useEffect(() => {
    if (!hasProcessingProject) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [hasProcessingProject]);

  useEffect(() => {
    if (!hasProcessingProject) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/ppt/projects", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { projects?: ProjectListItem[] }
          | null;
        if (!res.ok || !data?.projects || cancelled) return;
        setPolledItems(data.projects);
        const changedToTerminal = data.projects.some((project) => {
          const previous = statusRef.current.get(project.id);
          return (
            previous &&
            previous !== project.status &&
            !isPptProcessingStatus(project.status)
          );
        });
        statusRef.current = new Map(
          data.projects.map((item) => [item.id, item.status]),
        );
        if (changedToTerminal) router.refresh();
      } catch {
        // 保持当前列表，下一轮继续尝试。
      }
    };

    const interval = window.setInterval(poll, 2500);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasProcessingProject, router]);

  if (items.length === 0) {
    return (
      <Card className="rounded-lg p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">暂无项目，先创建一个 PPT。</p>
      </Card>
    );
  }

  return (
    <aside
      className={cn(
        "space-y-3",
        compact &&
          "2xl:sticky 2xl:top-20 2xl:max-h-[calc(100dvh-6rem)] 2xl:self-start 2xl:overflow-y-auto 2xl:pr-1",
      )}
    >
      {compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">最近项目</h2>
            <p className="text-sm text-muted-foreground">生成记录与下载入口</p>
          </div>
        </div>
      )}
      {items.map((project) => {
        const status = STATUS_MAP[project.status as keyof typeof STATUS_MAP] || STATUS_MAP.PENDING;
        const StatusIcon = status.icon;
        const isProcessing = isPptProcessingStatus(project.status);
        const progress = Math.max(0, Math.min(100, Math.round(project.progress || 0)));
        const durationLabel = formatProjectDurationLabel({
          startedAt: project.createdAt,
          completedAt: project.completedAt,
          updatedAt: project.updatedAt,
          running: isProcessing,
          now,
        });

        return (
          <Card key={project.id} className={cn("rounded-lg shadow-sm", compact ? "p-4" : "p-6")}>
            <div className={cn("flex flex-col gap-4", compact ? "" : "md:flex-row md:items-start md:justify-between")}>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h3 className="truncate font-semibold">{project.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatTime(project.createdAt)}
                    {durationLabel ? ` · ${durationLabel}` : ""}
                    {project.slideCount ? ` · ${project.slideCount} 页` : ""}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("gap-1", status.className)}>
                    <StatusIcon className={cn("size-3", isProcessing && "animate-spin")} />
                    {status.label}
                  </Badge>
                  <Badge variant="secondary">{sourceTypeLabel(project.sourceType)}</Badge>
                </div>

                {isProcessing && (
                  <div className="space-y-1.5">
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <p className="truncate">{project.currentPhase || status.label}</p>
                      <p className="shrink-0">{progress}%</p>
                    </div>
                  </div>
                )}
                {!isProcessing && project.status === "FAILED" && (
                  <p className="line-clamp-2 text-xs text-destructive">
                    {project.error || PPT_USER_FAILURE_MESSAGE}
                  </p>
                )}
                {project.updatedAt && (
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(project.updatedAt)}
                  </p>
                )}
              </div>

              <div className={cn("flex shrink-0 flex-wrap gap-2", compact && "grid grid-cols-2")}>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/ppt/${project.id}`}>
                    <ExternalLink className="size-4" />
                    查看
                  </Link>
                </Button>
                {isProcessing && <CancelProjectButton projectId={project.id} />}
                {project.status === "COMPLETED" && project.pptxPath && (
                  <Button asChild size="sm">
                    <a href={`/api/ppt/projects/${project.id}/export`}>
                      <Download className="size-4" />
                      下载
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </aside>
  );
}
