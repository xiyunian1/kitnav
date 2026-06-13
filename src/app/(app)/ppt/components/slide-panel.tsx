"use client";

import Link from "next/link";
import { memo } from "react";
import { Download, FileText, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PptSlideContent, SerializedPptProject } from "@/lib/ppt-shared";
import { cn } from "@/lib/utils";
import { getProjectTemplate, hasSlideId, TEMPLATE_LABELS } from "./shared";
import { SlidePreview } from "./slide-preview";

interface Props {
  active: SerializedPptProject | null;
  draft: PptSlideContent | null;
  selectedSlideId: string;
  onSelectSlide: (id: string) => void;
}

export const SlidePanel = memo(function SlidePanel({
  active,
  draft,
  selectedSlideId,
  onSelectSlide,
}: Props) {
  return (
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{active?.title || "还没有 PPT"}</CardTitle>
        {active && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/ppt/${active.id}/present`}>
                <Play className="size-4" />
                演示
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/ppt/projects/${active.id}/export`}>
                <Download className="size-4" />
                导出
              </a>
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid min-h-0 gap-4 lg:grid-cols-[170px_minmax(0,1fr)]">
        <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
          {active?.slides.map((slide) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => hasSlideId(slide) && onSelectSlide(slide.id)}
              className={cn(
                "w-full rounded-lg border p-3 text-left text-sm transition",
                selectedSlideId === slide.id
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="outline">{slide.order}</Badge>
                <span className="text-[10px] text-muted-foreground">
                  {slide.imageStatus === "SUCCESS" ? "视觉" : "文字版"} ·{" "}
                  {active?.generationMode === "TEMPLATE" ? TEMPLATE_LABELS[getProjectTemplate(active)] : "自由生成"}
                </span>
              </div>
              <div className="line-clamp-2 font-medium">{slide.title}</div>
            </button>
          ))}
          {!active && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              从左侧输入主题生成第一份 PPT。
            </div>
          )}
        </div>

        <div className="min-w-0 overflow-y-auto">
          {draft && active ? (
            <SlidePreview slide={draft} project={active} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择一页进行预览和编辑
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

export const RecentProjects = memo(function RecentProjects({
  projects,
  activeId,
  onSelect,
}: {
  projects: SerializedPptProject[];
  activeId: string;
  onSelect: (project: SerializedPptProject) => void;
}) {
  if (projects.length === 0) return null;
  return (
    <Card className="xl:col-span-3">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" />
          最近 PPT
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {projects.slice(0, 8).map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => onSelect(project)}
            className={cn(
              "rounded-lg border p-3 text-left transition hover:border-primary/50",
              activeId === project.id && "border-primary bg-primary/5"
            )}
          >
            <div className="line-clamp-2 text-sm font-medium">{project.title}</div>
            <div className="mt-2 text-xs text-muted-foreground">
              {project.slideCount} 页 ·{" "}
              {project.generationMode === "TEMPLATE" ? TEMPLATE_LABELS[getProjectTemplate(project)] : "自由生成"} ·{" "}
              {project.status}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
});
