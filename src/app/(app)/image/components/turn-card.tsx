"use client";

import { memo, useState, useTransition } from "react";
import Image from "next/image";
import {
  Clock3,
  FileText,
  ImageOff,
  Loader2,
  Save,
  Sparkles,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn, isOptimizableImageUrl } from "@/lib/utils";
import type { ReuseTurnInput, Turn } from "../types";

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

function formatDuration(ms?: number | null) {
  if (!ms || ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function getTurnQuality(turn: Turn) {
  return turn.images.find((img) => img.quality)?.quality || "标准";
}

function qualityValue(quality?: string) {
  if (quality === "高清" || quality === "hd") return "hd";
  if (quality === "超清" || quality === "ultra") return "ultra";
  return "standard";
}

function diagnoseError(message?: string | null) {
  if (!message) return "生成失败";
  if (message.includes("用户已停止")) return "用户已停止生成";
  if (message.includes("524") || message.includes("网关超时") || message.includes("响应超时")) {
    return "上游超时：图片处理过久未返回，可以降低张数或稍后再试";
  }
  if (message.includes("502") || message.includes("503") || message.includes("504") || message.includes("暂时不可用")) {
    return "上游服务不稳定：当前模型或通道暂时不可用";
  }
  if (message.includes("积分不足")) return message;
  if (message.includes("API") || message.includes("Base URL") || message.includes("无法连接")) {
    return "API 配置异常：请检查 Base URL、Key 或当前模型是否可用";
  }
  if (message.includes("不支持图生图") || message.includes("图片编辑")) {
    return "模型能力不匹配：当前模型可能不支持图生图";
  }
  if (message.includes("保存失败") || message.includes("无法读取图片")) {
    return "图片保存失败：生成可能已完成，但保存到素材文件时出错";
  }
  return message;
}

interface Props {
  turn: Turn;
  index: number;
  onContinueEdit: (url: string) => void;
  onReusePrompt: (prompt: string) => void;
  onRegenerate: (input: ReuseTurnInput) => void;
  onGenerateSimilar: (url: string, input: ReuseTurnInput) => void;
  stopping: boolean;
  onStop: (turnId: string) => void;
}

export const TurnCard = memo(function TurnCard({
  turn,
  index,
  onContinueEdit,
  onReusePrompt,
  onRegenerate,
  onGenerateSimilar,
  stopping,
  onStop,
}: Props) {
  const ac = aspectClass(turn.ratio);
  const [preview, setPreview] = useState<{ src: string; alt: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const turnError = getTurnErrorMessage(turn);
  const turnDuration = formatDuration(turn.durationMs);
  const turnQuality = getTurnQuality(turn);

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
            meta: {
              mode: turn.mode,
              ratio: turn.ratio,
              quality: qualityValue(turnQuality),
              count: turn.count,
              model: turn.model,
              modelSource: turn.providerSource ?? undefined,
              durationMs: turn.durationMs,
            },
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
            meta: {
              mode: turn.mode,
              ratio: turn.ratio,
              count: turn.count,
              model: turn.model,
              modelSource: turn.providerSource ?? undefined,
              quality: qualityValue(turnQuality),
            },
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
      <section
        className="overflow-hidden rounded-xl border bg-card"
        style={{ contentVisibility: "auto", containIntrinsicSize: "auto 480px" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>第 {index + 1} 轮</span>
              <Badge variant={turn.mode === "edit" ? "secondary" : "default"}>
                {turn.mode === "edit" ? "图生图" : "文生图"}
              </Badge>
              <span>{turn.ratio}</span>
              <span>{turnQuality}</span>
              <span>{turn.count} 张</span>
              {turnDuration && <span>耗时 {turnDuration}</span>}
            </div>
            <p className="line-clamp-2 text-sm">{turn.prompt}</p>
          </div>
          {turn.status === "PENDING" && (
            <Button
              variant="outline"
              size="icon-sm"
              disabled={stopping}
              onClick={() => onStop(turn.id)}
              title={stopping ? "正在停止" : "停止生成"}
              aria-label={stopping ? "正在停止生成" : "停止生成"}
            >
              {stopping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="size-3.5" />
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onReusePrompt(turn.prompt)}>
            <Sparkles className="size-3.5" /> 复用提示词
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onRegenerate({
                prompt: turn.prompt,
                mode: turn.mode,
                ratio: turn.ratio,
                quality: qualityValue(turnQuality),
                count: turn.count,
                model: turn.model,
                modelSource: turn.providerSource ?? undefined,
              })
            }
          >
            <Sparkles className="size-3.5" /> 重新生成
          </Button>
          <Button variant="ghost" size="sm" disabled={saving} onClick={savePrompt}>
            <FileText className="size-3.5" /> 保存提示词
          </Button>
        </div>

        {turn.referenceThumbs.length > 0 && (
          <div className="flex flex-wrap items-start gap-2 border-b px-4 py-3">
            <span className="pt-1 text-xs text-muted-foreground">
              参考图 {turn.referenceThumbs.length} 张
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-2">
              {turn.referenceThumbs.map((thumb, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPreview({ src: thumb, alt: `参考图 ${i + 1}` })}
                  className="relative rounded-md outline-none ring-offset-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  title="查看参考图"
                  aria-label={`查看参考图 ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumb}
                    alt={`参考图 ${i + 1}`}
                    className="size-12 rounded-md border object-cover"
                  />
                  <span className="pointer-events-none absolute left-1 top-1 flex size-4 items-center justify-center rounded bg-black/70 text-[9px] font-medium text-white">
                    {i + 1}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {turn.images.map((img) => {
            if (img.status === "success" && img.url) {
              const alt = `第 ${index + 1} 轮生成图 ${Number(img.id) + 1}`;
              const imageDuration = formatDuration(img.durationMs);
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
                    aria-label={`查看大图：${alt}`}
                  >
                    <Image
                      src={img.url}
                      alt={alt}
                      fill
                      unoptimized={!isOptimizableImageUrl(img.url)}
                      loading="lazy"
                      sizes="(min-width: 1024px) 28vw, (min-width: 640px) 42vw, 90vw"
                      className="object-cover"
                    />
                  </button>
                  <div className="space-y-2 p-2">
                    <div className="truncate text-xs text-muted-foreground">
                      {[img.quality || turnQuality, imageDuration].filter(Boolean).join(" · ")}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        className="w-full px-1"
                        disabled={saving}
                        onClick={() => saveImage(img.url!, Number(img.id) || 0)}
                        title="保存到我的素材库"
                        aria-label={`保存${alt}到我的素材库`}
                      >
                        <Save className="size-3" /> 保存
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        className="w-full px-1"
                        onClick={() => onContinueEdit(img.url!)}
                        title="以此图继续编辑"
                        aria-label={`以${alt}继续编辑`}
                      >
                        <Sparkles className="size-3" /> 编辑
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        className="w-full px-1"
                        onClick={() =>
                          onGenerateSimilar(img.url!, {
                            prompt: turn.prompt,
                            mode: "edit",
                            ratio: turn.ratio,
                            quality: qualityValue(img.quality || turnQuality),
                            count: 1,
                            model: turn.model,
                            modelSource: turn.providerSource ?? undefined,
                          })
                        }
                        title="生成相似图"
                        aria-label={`基于${alt}生成相似图`}
                      >
                        <Sparkles className="size-3" /> 相似
                      </Button>
                    </div>
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
                  <p className="text-xs text-destructive">{diagnoseError(img.error)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[img.quality || turnQuality, formatDuration(img.durationMs)].filter(Boolean).join(" · ")}
                  </p>
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
                <p className="text-xs text-muted-foreground">{img.quality || turnQuality}</p>
              </div>
            );
          })}
        </div>

        {turnError && turn.status !== "PENDING" && (
          <div className="mx-4 mb-4 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            {diagnoseError(turnError)}
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
});
