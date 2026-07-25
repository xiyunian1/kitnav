"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ClipboardEvent } from "react";
import { ArrowUp, ChevronDown, ImagePlus, Loader2, Settings2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASPECT_RATIOS, MAX_IMAGE_COUNT } from "@/lib/providers/types";
import { IMAGE_QUALITIES, IMAGE_QUALITY_META } from "@/lib/image-quality";
import { PresetPrompts } from "./preset-prompts-trigger";
import type { ImagePreset } from "@/lib/image-presets";
import { MaterialPicker } from "@/components/materials/material-picker-trigger";
import type { MaterialView } from "@/components/materials/material-types";
import { cn } from "@/lib/utils";
import type { PromptOptimizationResult, PromptOptimizeRequest } from "../types";
import type { ModuleModelOption } from "@/lib/module-model-options";
import {
  MAX_REFERENCE_IMAGE_COUNT,
  REFERENCE_IMAGE_MIME_TYPES,
} from "@/lib/image-edit-capabilities";

const PromptOptimizerDialog = dynamic(
  () => import("./prompt-optimizer-dialog").then((mod) => mod.PromptOptimizerDialog),
  { ssr: false }
);

const RATIO_LABELS: Record<string, string> = {
  "1:1": "1:1 正方形",
  "16:9": "16:9 横版",
  "4:3": "4:3 横版",
  "3:4": "3:4 竖版",
  "9:16": "9:16 竖版",
};

export interface ReferencePreview {
  file: File;
  name: string;
  previewUrl: string;
}

interface Props {
  mode: "generate" | "edit";
  prompt: string;
  ratio: string;
  quality: string;
  count: number;
  modelValue: string;
  modelOptions: ModuleModelOption[];
  references: ReferencePreview[];
  preparingReferences: boolean;
  submitting: boolean;
  stopping: boolean;
  unitCost: number;
  readOnly: boolean;
  onModeChange: (mode: "generate" | "edit") => void;
  onPromptChange: (value: string) => void;
  onRatioChange: (value: string) => void;
  onQualityChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onModelChange: (value: string) => void;
  onPickFiles: (files: File[]) => void;
  onPickMaterial: (material: MaterialView) => void;
  onRemoveReference: (index: number) => void;
  onPickPreset: (preset: ImagePreset) => void;
  onSubmit: () => void;
  onStop: () => void;
  onOptimizePrompt: (request: PromptOptimizeRequest) => Promise<PromptOptimizationResult>;
}

export function PromptComposer({
  mode,
  prompt,
  ratio,
  quality,
  count,
  modelValue,
  modelOptions,
  references,
  preparingReferences,
  submitting,
  stopping,
  unitCost,
  readOnly,
  onModeChange,
  onPromptChange,
  onRatioChange,
  onQualityChange,
  onCountChange,
  onModelChange,
  onPickFiles,
  onPickMaterial,
  onRemoveReference,
  onPickPreset,
  onSubmit,
  onStop,
  onOptimizePrompt,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ReferencePreview | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  // 首次打开后才挂载优化弹窗，配合 dynamic 按需加载
  const [optimizerMounted, setOptimizerMounted] = useState(false);
  const activeModel =
    modelOptions.find((option) => option.value === modelValue) ?? modelOptions[0];
  const visiblePreview =
    preview &&
    references.some((reference) => reference.previewUrl === preview.previewUrl)
      ? preview
      : null;
  const multiImageUnsupported =
    mode === "edit" &&
    references.length > 1 &&
    !activeModel?.supportsMultiImageEdit;
  const canSubmit =
    prompt.trim().length > 0 &&
    (mode === "generate" || references.length > 0) &&
    Boolean(activeModel) &&
    !multiImageUnsupported &&
    !preparingReferences &&
    !submitting &&
    !readOnly;
  const qualityMeta =
    IMAGE_QUALITY_META[quality as keyof typeof IMAGE_QUALITY_META] ?? IMAGE_QUALITY_META.standard;
  const useOwnKey = activeModel?.source === "user";
  const selectedUnitCost = activeModel?.creditCost ?? unitCost;
  const totalCost = useOwnKey ? 0 : selectedUnitCost * qualityMeta.costMultiplier * count;
  const settingsSummary = [
    ratio,
    `${count}张`,
    qualityMeta.label,
    activeModel ? `${activeModel.model} · ${activeModel.sourceLabel}` : "暂无模型",
  ].join(" · ");

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    e.preventDefault();
    if (readOnly || preparingReferences || submitting) return;
    onModeChange("edit");
    onPickFiles(files);
  }

  return (
    <>
      <div className="flex min-h-0 flex-col md:h-full md:overflow-hidden">
        <div className="space-y-4 pr-1 md:min-h-0 md:flex-1 md:overflow-y-auto">
          <div>
            <h2 className="font-semibold">创作台</h2>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mode === "generate" ? "default" : "outline"}
              size="sm"
              onClick={() => onModeChange("generate")}
            >
              文生图
            </Button>
            <Button
              variant={mode === "edit" ? "default" : "outline"}
              size="sm"
              onClick={() => onModeChange("edit")}
            >
              图生图
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="prompt">提示词</Label>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={readOnly || !prompt.trim() || submitting}
                onClick={() => {
                  setOptimizerMounted(true);
                  setOptimizerOpen(true);
                }}
              >
                <Sparkles className="size-3" />
                优化
              </Button>
            </div>
            <Textarea
              id="prompt"
              rows={7}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              onPaste={handlePaste}
              placeholder={mode === "edit" ? "描述你想如何修改参考图，也可直接粘贴图片" : "描述你想生成的画面，也可直接粘贴图片"}
              maxLength={4000}
              className="resize-none"
            />
          </div>

          {mode === "edit" && (
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept={REFERENCE_IMAGE_MIME_TYPES.join(",")}
                multiple
                disabled={readOnly || preparingReferences || submitting}
                className="hidden"
                onChange={(e) => {
                  onPickFiles(Array.from(e.target.files || []));
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>参考图</span>
                <span>{references.length}/{MAX_REFERENCE_IMAGE_COUNT}</span>
              </div>
              {references.length > 0 ? (
                <div className="flex flex-wrap gap-2" aria-busy={preparingReferences}>
                  {references.map((ref, i) => (
                    <div key={ref.previewUrl} className="relative size-16">
                      <button
                        type="button"
                        onClick={() => setPreview(ref)}
                        className="rounded-lg outline-none ring-offset-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        title="查看参考图"
                        aria-label={`查看参考图：${ref.name}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ref.previewUrl} alt={ref.name} className="size-16 rounded-lg border object-cover" />
                      </button>
                      <span className="pointer-events-none absolute left-1 top-1 flex size-5 items-center justify-center rounded bg-black/70 text-[10px] font-medium text-white">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        disabled={readOnly || preparingReferences || submitting}
                        onClick={() => {
                          if (preview?.previewUrl === ref.previewUrl) setPreview(null);
                          onRemoveReference(i);
                        }}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-destructive"
                        aria-label={`移除参考图：${ref.name}`}
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                disabled={
                  preparingReferences ||
                  submitting ||
                  readOnly ||
                  references.length >= MAX_REFERENCE_IMAGE_COUNT
                }
                onClick={() => fileInputRef.current?.click()}
              >
                {preparingReferences ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {preparingReferences
                  ? "正在处理参考图"
                  : references.length > 0
                    ? "继续添加参考图"
                    : "上传参考图"}
              </Button>
              <MaterialPicker
                onPick={onPickMaterial}
                disabled={
                  preparingReferences ||
                  submitting ||
                  readOnly ||
                  references.length >= MAX_REFERENCE_IMAGE_COUNT
                }
              />
              {multiImageUnsupported && (
                <p className="text-xs text-destructive">
                  当前模型不支持多张参考图，请更换带“多图”标记的模型或删除至 1 张。
                </p>
              )}
            </div>
          )}

          <PresetPrompts onPick={onPickPreset} />

          <div className="rounded-lg border bg-background">
            <button
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            >
              <Settings2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">生成设置</div>
                <div className="truncate text-xs text-muted-foreground">{settingsSummary}</div>
              </div>
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", settingsOpen && "rotate-180")}
              />
            </button>

            {settingsOpen && (
              <div className="space-y-3 border-t p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>比例</Label>
                    <Select value={ratio} onValueChange={onRatioChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASPECT_RATIOS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {RATIO_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>张数</Label>
                    <Select value={String(count)} onValueChange={(v) => onCountChange(Number(v))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: MAX_IMAGE_COUNT }, (_, i) => i + 1).map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} 张
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>清晰度</Label>
                  <Select value={quality} onValueChange={onQualityChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_QUALITIES.map((q) => (
                        <SelectItem key={q} value={q}>
                          {IMAGE_QUALITY_META[q].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {modelOptions.length > 0 ? (
                  <div className="space-y-2">
                    <Label>模型</Label>
                    {modelOptions.length > 1 ? (
                      <Select value={activeModel?.value} onValueChange={onModelChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {modelOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate">{option.model}</span>
                                <span
                                  className={cn(
                                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                                    option.source === "user"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                      : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                                  )}
                                >
                                  {option.sourceLabel}
                                </span>
                                {option.supportsMultiImageEdit && (
                                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                                    多图
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                        <span className="min-w-0 truncate">{activeModel?.model}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {activeModel?.sourceLabel}
                        </span>
                        {activeModel?.supportsMultiImageEdit && (
                          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                            多图
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    暂无可用模型，请先在 API 设置中保存模型或联系管理员。
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 shrink-0 space-y-3 border-t bg-card pt-3">
          <div className="rounded-lg bg-muted px-3 py-2 text-sm">
            {!activeModel ? (
              <span className="text-muted-foreground">暂无可用模型</span>
            ) : useOwnKey ? (
              <span className="text-green-600 dark:text-green-400">使用我的 API · 不消耗积分</span>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">预计消耗</span>
                <span className="font-medium">{totalCost} 积分</span>
              </div>
            )}
          </div>

          <Button
            className="w-full"
            size="lg"
            onClick={submitting ? onStop : onSubmit}
            disabled={readOnly || (submitting ? stopping : !canSubmit)}
            variant={submitting ? "outline" : "default"}
          >
            {readOnly ? (
              <>
                <ArrowUp className="size-4" /> 仅供参观
              </>
            ) : stopping ? (
              <>
                <Loader2 className="size-4 animate-spin" /> 正在停止...
              </>
            ) : submitting ? (
              <>
                <X className="size-4" /> 停止生成
              </>
            ) : (
              <>
                <ArrowUp className="size-4" /> {mode === "edit" ? "编辑图片" : "生成图片"}
              </>
            )}
          </Button>
        </div>
      </div>

      <Dialog open={!!visiblePreview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">{visiblePreview?.name ?? "参考图预览"}</DialogTitle>
          <DialogDescription className="sr-only">预览当前选中的参考图。</DialogDescription>
          {visiblePreview && (
            <div className="flex max-h-[calc(100vh-5rem)] items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={visiblePreview.previewUrl}
                alt={visiblePreview.name}
                className="max-h-[calc(100vh-5rem)] max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {optimizerMounted && (
        <PromptOptimizerDialog
          open={optimizerOpen}
          prompt={prompt}
          mode={mode}
          ratio={ratio}
          quality={quality}
          count={count}
          model={activeModel?.model ?? ""}
          submitting={submitting}
          onOpenChange={setOptimizerOpen}
          onOptimize={onOptimizePrompt}
          onApplyPrompt={onPromptChange}
          onApplySettings={({ ratio: nextRatio, quality: nextQuality, count: nextCount }) => {
            if (nextRatio) onRatioChange(nextRatio);
            if (nextQuality) onQualityChange(nextQuality);
            if (typeof nextCount === "number") onCountChange(nextCount);
          }}
        />
      )}
    </>
  );
}

export { RATIO_LABELS };
