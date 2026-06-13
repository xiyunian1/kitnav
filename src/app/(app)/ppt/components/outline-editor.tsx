"use client";

import { memo } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PptOutlineSlide, PptSlideContent } from "@/lib/ppt-shared";

const PPT_LAYOUTS: PptSlideContent["layout"][] = [
  "COVER",
  "AGENDA",
  "CONTENT",
  "SECTION",
  "COMPARISON",
  "TIMELINE",
  "SUMMARY",
  "THANKS",
];
const PPT_LAYOUT_LABELS: Record<PptSlideContent["layout"], string> = {
  COVER: "封面",
  AGENDA: "目录",
  CONTENT: "内容",
  SECTION: "章节",
  COMPARISON: "对比",
  TIMELINE: "时间线",
  SUMMARY: "总结",
  THANKS: "致谢",
};

interface Props {
  title: string;
  slides: PptOutlineSlide[];
  onTitleChange: (value: string) => void;
  onUpdateSlide: (index: number, patch: Partial<PptOutlineSlide>) => void;
  onUpdateBullets: (index: number, value: string) => void;
  onMoveSlide: (index: number, direction: -1 | 1) => void;
  onRemoveSlide: (index: number) => void;
  onAddSlide: () => void;
}

export const OutlineEditor = memo(function OutlineEditor({
  title,
  slides,
  onTitleChange,
  onUpdateSlide,
  onUpdateBullets,
  onMoveSlide,
  onRemoveSlide,
  onAddSlide,
}: Props) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>生成前大纲</Label>
        <Badge variant="secondary">{slides.length} 页</Badge>
      </div>
      <Input
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="整套 PPT 标题"
        maxLength={80}
      />
      <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
        {slides.map((slide, index) => (
          <div key={`${slide.order}-${index}`} className="space-y-3 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="shrink-0">
                {slide.order}
              </Badge>
              <Select
                value={slide.layout}
                onValueChange={(value) =>
                  onUpdateSlide(index, { layout: value as PptSlideContent["layout"] })
                }
              >
                <SelectTrigger className="h-8 min-w-0 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PPT_LAYOUTS.map((layout) => (
                    <SelectItem key={layout} value={layout}>
                      {PPT_LAYOUT_LABELS[layout]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="上移"
                aria-label="上移"
                onClick={() => onMoveSlide(index, -1)}
                disabled={index === 0}
              >
                <ArrowUp className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="下移"
                aria-label="下移"
                onClick={() => onMoveSlide(index, 1)}
                disabled={index === slides.length - 1}
              >
                <ArrowDown className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                title="删除"
                aria-label="删除"
                onClick={() => onRemoveSlide(index)}
                disabled={slides.length <= 3}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <Input
              value={slide.title}
              onChange={(event) => onUpdateSlide(index, { title: event.target.value })}
              placeholder="页标题"
              maxLength={80}
            />
            <Textarea
              className="min-h-24 resize-none text-sm"
              value={slide.bullets.join("\n")}
              onChange={(event) => onUpdateBullets(index, event.target.value)}
              placeholder="每行一个要点"
            />
          </div>
        ))}
      </div>
      <Button
        type="button"
        className="w-full"
        variant="outline"
        onClick={onAddSlide}
        disabled={slides.length >= 20}
      >
        <Plus className="size-4" />
        增加一页
      </Button>
    </div>
  );
});
