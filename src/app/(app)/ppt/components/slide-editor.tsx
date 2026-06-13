"use client";

import { memo } from "react";
import { ImageIcon, Loader2, Pencil, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { PptSlideContent } from "@/lib/ppt-shared";

interface Props {
  draft: PptSlideContent | null;
  pending: boolean;
  rewriteInstruction: string;
  onDraftChange: <K extends keyof PptSlideContent>(key: K, value: PptSlideContent[K]) => void;
  onRewriteInstructionChange: (value: string) => void;
  onSave: () => void;
  onRegenerateVisual: () => void;
  onRewrite: () => void;
}

export const SlideEditor = memo(function SlideEditor({
  draft,
  pending,
  rewriteInstruction,
  onDraftChange,
  onRewriteInstructionChange,
  onSave,
  onRegenerateVisual,
  onRewrite,
}: Props) {
  return (
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pencil className="size-4" />
          单页编辑
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {draft ? (
          <>
            <div className="space-y-2">
              <Label>标题</Label>
              <Input value={draft.title} onChange={(event) => onDraftChange("title", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>副标题</Label>
              <Input value={draft.subtitle || ""} onChange={(event) => onDraftChange("subtitle", event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>要点</Label>
              <Textarea
                className="min-h-32 resize-none"
                value={draft.bullets.join("\n")}
                onChange={(event) =>
                  onDraftChange(
                    "bullets",
                    event.target.value
                      .split(/\n+/)
                      .map((item) => item.trim())
                      .filter(Boolean)
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>演讲备注</Label>
              <Textarea
                className="min-h-24 resize-none"
                value={draft.speakerNotes || ""}
                onChange={(event) => onDraftChange("speakerNotes", event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>视觉描述</Label>
              <Textarea
                className="min-h-24 resize-none"
                placeholder="描述这一页希望呈现的背景、构图、图表、质感"
                value={draft.visualPrompt || ""}
                onChange={(event) => onDraftChange("visualPrompt", event.target.value)}
              />
            </div>
            <Button className="w-full" onClick={onSave} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存本页
            </Button>
            <Button className="w-full" variant="secondary" onClick={onRegenerateVisual} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              重绘本页视觉
            </Button>
            {draft.imageStatus === "FAILED" && draft.imageError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
                {draft.imageError}
              </div>
            )}
            <Separator />
            <div className="space-y-2">
              <Label>AI 修改要求</Label>
              <Textarea
                className="min-h-24 resize-none"
                placeholder="例如：把这一页改得更有说服力，并增加商业价值"
                value={rewriteInstruction}
                onChange={(event) => onRewriteInstructionChange(event.target.value)}
              />
            </div>
            <Button className="w-full" variant="outline" onClick={onRewrite} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              AI 改写本页
            </Button>
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            生成或选择一页后可编辑。
          </div>
        )}
      </CardContent>
    </Card>
  );
});
