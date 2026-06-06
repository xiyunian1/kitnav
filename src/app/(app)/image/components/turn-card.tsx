"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { Clock3, FileText, Loader2, Sparkles, ImageOff, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Turn } from "../types";

function aspectClass(ratio: string) {
  switch (ratio) {
    case "16:9":
      return "aspect-video";
    case "9:16":
      return "aspect-[9/16]";
    case "4:3":
      return "aspect-[4/3]";
    case "3:4":
      return "aspect-[3/4]";
    default:
      return "aspect-square";
  }
}

function getTurnErrorMessage(turn: Turn) {
  return turn.images.find((img) => img.status === "error" && img.error)?.error || turn.error;
}

interface Props {
  turn: Turn;
  index: number;
  onContinueEdit: (url: string) => void;
  onReusePrompt: (prompt: string) => void;
}

export function TurnCard({ turn, index, onContinueEdit, onReusePrompt }: Props) {
  const ac = aspectClass(turn.ratio);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const turnError = getTurnErrorMessage(turn);

  function saveImage(url: string, imageIndex: number) {
    startSaving(async () => {
      try {
        const res = await fetch("/api/materials/save-generated", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            title: `${turn.prompt.slice(0, 24) || "生成图片"} ${imageIndex + 1}`,
            prompt: turn.prompt,
            generationId: turn.generationId || undefined,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) toast.error(data.error || "保存失败");
        else toast.success("已保存到我的素材库");
      } catch {
        toast.error("保存失败");
      }
    });
  }

  function savePrompt() {
    startSaving(async () => {
      try {
        const res = await fetch("/api/materials/prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: turn.prompt.slice(0, 24) || "生成提示词",
            promptText: turn.prompt,
            description: `来自第 ${index + 1} 轮图片生成`,
            visibility: "PRIVATE",
            meta: { mode: turn.mode, ratio: turn.ratio, count: turn.count, model: turn.model },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) toast.error(data.error || "保存失败");
        else toast.success("提示词已保存到我的素材库");
      } catch {
        toast.error("保存失败");
      }
    });
  }

  return (
    <>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>第 {index + 1} 轮</span>
              <Badge variant={turn.mode === "edit" ? "secondary" : "default"}>
                {turn.mode === "edit" ? "图生图" : "文生图"}
              </Badge>
              <span>{turn.ratio}</span>
              <span>{turn.count} 张</span>
            </div>
            <p className="line-clamp-2 text-sm">{turn.prompt}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onReusePrompt(turn.prompt)}>
            <Sparkles className="size-3.5" /> 复用提示词
          </Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={savePrompt}>
            <FileText className="size-3.5" /> 保存提示词
          </Button>
        </div>

        {turn.referenceThumbs.length > 0 && (
          <div className="flex gap-2 border-b px-4 py-3">
            <span className="text-xs text-muted-foreground">参考图</span>
            {turn.referenceThumbs.map((thumb, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPreview({ src: thumb, alt: `参考图 ${i + 1}` })}
                className="rounded-md outline-none ring-offset-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                title="查看参考图"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb}
                  alt={`参考图 ${i + 1}`}
                  className="size-12 rounded-md border object-cover"
                />
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {turn.images.map((img) => {
            if (img.status === "success" && img.url) {
              const alt = `第 ${index + 1} 轮生成图 ${Number(img.id) + 1}`;
              return (
                <div key={img.id} className="group overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    onClick={() => setPreview({ src: img.url!, alt })}
                    className={cn(
                      "relative block w-full bg-muted outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      ac
                    )}
                    title="查看大图"
                  >
                    <Image
                      src={img.url}
                      alt={alt}
                      fill
                      unoptimized
                      loading="lazy"
                      sizes="(min-width: 1024px) 28vw, (min-width: 640px) 42vw, 90vw"
                      className="object-cover"
                    />
                  </button>
                  <div className="flex items-center justify-end gap-1 p-2">
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={saving}
                      onClick={() => saveImage(img.url!, Number(img.id) || 0)}
                      title="保存到我的素材库"
                    >
                      <Save className="size-3" /> 保存
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => onContinueEdit(img.url!)}
                      title="以此图继续编辑"
                    >
                      <Sparkles className="size-3" /> 编辑
                    </Button>
                  </div>
                </div>
              );
            }
            if (img.status === "error") {
              return (
                <div
                  key={img.id}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center",
                    ac
                  )}
                >
                  <ImageOff className="size-5 text-destructive/70" />
                  <p className="text-xs text-destructive">{img.error || "生成失败"}</p>
                </div>
              );
            }
            return (
              <div
                key={img.id}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border bg-muted/40 text-muted-foreground",
                  ac
                )}
              >
                {img.status === "loading" && turn.status === "PENDING" ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Clock3 className="size-5" />
                )}
                <p className="text-xs">
                  {img.status === "loading" && turn.status === "PENDING" ? "生成中…" : "等待中"}
                </p>
              </div>
            );
          })}
        </div>

        {turnError && turn.status !== "PENDING" && (
          <div className="mx-4 mb-4 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            {turnError}
          </div>
        )}
      </section>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">{preview?.alt ?? "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">预览当前轮次中的参考图或生成图。</DialogDescription>
          {preview && (
            <div className="flex max-h-[calc(100vh-5rem)] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.src}
                alt={preview.alt}
                className="max-h-[calc(100vh-5rem)] max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
