"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  Presentation,
  XCircle,
} from "lucide-react";
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
  currentPhase?: string | null;
  slideCount: number | null;
  aspectRatio?: string | null;
  createdAt: Date | string;
  completedAt: Date | string | null;
  updatedAt?: Date | string;
  pptxPath: string | null;
  coverUrl?: string | null;
  error?: string | null;
}

interface Props {
  projects: ProjectListItem[];
}

const STATUS_MAP = {
  PENDING: { label: "等待中", icon: Clock, className: "border-slate-200 bg-white/90 text-slate-700" },
  QUEUED: { label: "排队中", icon: Clock, className: "border-blue-200 bg-white/90 text-blue-700" },
  STRATEGIZING: { label: "规划中", icon: Loader2, className: "border-violet-200 bg-white/90 text-violet-700" },
  ACQUIRING_IMAGES: { label: "采集素材", icon: Loader2, className: "border-amber-200 bg-white/90 text-amber-700" },
  EXECUTING: { label: "生成中", icon: Loader2, className: "border-indigo-200 bg-white/90 text-indigo-700" },
  EXPORTING: { label: "导出中", icon: Loader2, className: "border-cyan-200 bg-white/90 text-cyan-700" },
  COMPLETED: { label: "已完成", icon: CheckCircle2, className: "border-emerald-200 bg-white/90 text-emerald-700" },
  FAILED: { label: "失败", icon: XCircle, className: "border-red-200 bg-white/90 text-red-700" },
} as const;

type ProjectFilter = "all" | "processing" | "completed" | "failed";

const FILTERS: Array<{ value: ProjectFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "processing", label: "生成中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatRelativeTime(value?: Date | string, now?: number | null) {
  if (!value) return "";
  if (!now) return formatTime(value);
  const diffMs = now - new Date(value).getTime();
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

function matchesFilter(project: ProjectListItem, filter: ProjectFilter) {
  if (filter === "all") return true;
  if (filter === "processing") return isPptProcessingStatus(project.status);
  if (filter === "completed") return project.status === "COMPLETED";
  return project.status === "FAILED";
}

export function ProjectList({ projects }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [polledItems, setPolledItems] = useState<ProjectListItem[] | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const items = polledItems ?? projects;
  const statusRef = useRef(new Map(projects.map((item) => [item.id, item.status])));
  const hasProcessingProject = useMemo(
    () => items.some((project) => isPptProcessingStatus(project.status)),
    [items],
  );
  const visibleItems = useMemo(
    () => items.filter((project) => matchesFilter(project, filter)),
    [filter, items],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(
      () => setNow(Date.now()),
      hasProcessingProject ? 1000 : 60_000,
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
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
        const nextProjects = data.projects;
        setPolledItems((current) => {
          const previous = current ?? projects;
          const coverById = new Map(previous.map((item) => [item.id, item.coverUrl]));
          return nextProjects.map((project) => ({
            ...project,
            coverUrl: coverById.get(project.id) ?? null,
          }));
        });
        const changedToTerminal = nextProjects.some((project) => {
          const previous = statusRef.current.get(project.id);
          return previous && previous !== project.status && !isPptProcessingStatus(project.status);
        });
        statusRef.current = new Map(nextProjects.map((item) => [item.id, item.status]));
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
  }, [hasProcessingProject, projects, router]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold">最近项目</h2>
          <span className="text-sm text-muted-foreground">{items.length} 个</span>
        </div>
        <div className="flex flex-wrap items-center gap-1" aria-label="项目筛选">
          {FILTERS.map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setFilter(item.value)}
              className={cn(
                "h-8 rounded-md px-3 font-normal",
                filter === item.value && "bg-muted font-medium text-foreground",
              )}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      {visibleItems.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed bg-muted/15 text-sm text-muted-foreground">
          {items.length === 0 ? "暂无项目" : "该分类暂无项目"}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((project) => {
            const status = STATUS_MAP[project.status as keyof typeof STATUS_MAP] || STATUS_MAP.PENDING;
            const StatusIcon = status.icon;
            const isProcessing = isPptProcessingStatus(project.status);
            const durationLabel = formatProjectDurationLabel({
              startedAt: project.createdAt,
              completedAt: project.completedAt,
              updatedAt: project.updatedAt,
              running: isProcessing,
              now,
            });

            return (
              <Card
                key={project.id}
                className="group overflow-hidden rounded-lg p-0 shadow-sm transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md"
              >
                <Link href={`/ppt/${project.id}`} className="block">
                  <div
                    className={cn(
                      "relative overflow-hidden bg-[#f2f4f7]",
                      project.aspectRatio === "4:3" ? "aspect-[4/3]" : "aspect-video",
                    )}
                  >
                    {project.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={project.coverUrl}
                        alt={`${project.title} 封面预览`}
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-muted/45 px-8 text-center">
                        <div className="space-y-3">
                          <span className="mx-auto flex size-11 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-sm ring-1 ring-border">
                            <Presentation className="size-5" />
                          </span>
                          <p className="line-clamp-2 text-sm font-medium text-muted-foreground">
                            {project.title}
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/5" />
                    <Badge
                      variant="outline"
                      className={cn("absolute top-3 left-3 gap-1 shadow-sm", status.className)}
                    >
                      <StatusIcon className={cn("size-3", isProcessing && "animate-spin")} />
                      {status.label}
                    </Badge>
                  </div>
                </Link>

                <div className="space-y-3 p-4">
                  <div>
                    <Link href={`/ppt/${project.id}`} className="block">
                      <h3 className="truncate font-semibold transition-colors hover:text-primary">
                        {project.title}
                      </h3>
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {formatTime(project.createdAt)}
                      {durationLabel ? ` · ${durationLabel}` : ""}
                      {project.slideCount ? ` · ${project.slideCount} 页` : ""}
                    </p>
                  </div>

                  <div className="flex min-h-6 items-center justify-between gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {sourceTypeLabel(project.sourceType)}
                    </Badge>
                    {project.updatedAt && (
                      <span className="truncate text-xs text-muted-foreground">
                        {formatRelativeTime(project.updatedAt, now)}
                      </span>
                    )}
                  </div>

                  {isProcessing && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 shrink-0 animate-spin" />
                      <p className="truncate">{project.currentPhase || status.label}</p>
                    </div>
                  )}
                  {!isProcessing && project.status === "FAILED" && (
                    <p className="line-clamp-2 text-xs text-destructive">
                      {project.error || PPT_USER_FAILURE_MESSAGE}
                    </p>
                  )}

                  <div className="flex items-center gap-2 border-t pt-3">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link href={`/ppt/${project.id}`}>
                        <ExternalLink className="size-4" />
                        查看
                      </Link>
                    </Button>
                    {isProcessing && <CancelProjectButton projectId={project.id} />}
                    {project.status === "COMPLETED" && project.pptxPath && (
                      <Button asChild variant="outline" size="icon" className="size-8" title="下载 PPTX">
                        <a href={`/api/ppt/projects/${project.id}/export`} aria-label="下载 PPTX">
                          <Download className="size-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
