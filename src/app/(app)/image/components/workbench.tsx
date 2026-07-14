"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useImageWorkbench } from "../hooks/use-image-workbench";
import { ConversationSidebar } from "./conversation-sidebar";
import { ResultStream } from "./result-stream";
import { PromptComposer, type ReferencePreview } from "./prompt-composer";
import { fileToThumbnail } from "../thumbnail";
import type { ImagePreset } from "@/lib/image-presets";
import type { MaterialView } from "@/components/materials/material-types";
import type { PromptOptimizationResult, PromptOptimizeRequest, ReuseTurnInput } from "../types";
import {
  findModuleModelOption,
  type ModelSource,
  type ModuleModelOption,
} from "@/lib/module-model-options";

interface Props {
  unitCost: number;
  credits: number;
  modelOptions: ModuleModelOption[];
  initialPrompt?: string;
  initialMode?: "generate" | "edit";
  initialRatio?: string;
  initialQuality?: string;
  initialCount?: number;
  initialModel?: string;
  initialModelSource?: ModelSource;
  initialImageMaterial?: MaterialView | null;
  initialPromptMaterial?: MaterialView | null;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function qualityValue(value: unknown) {
  if (value === "高清" || value === "hd") return "hd";
  if (value === "超清" || value === "ultra") return "ultra";
  return "standard";
}

function getStringMeta(meta: Record<string, unknown> | null | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function getNumberMeta(meta: Record<string, unknown> | null | undefined, key: string) {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function ImageWorkbench({
  unitCost,
  credits,
  modelOptions,
  initialPrompt = "",
  initialMode = "generate",
  initialRatio,
  initialQuality,
  initialCount,
  initialModel,
  initialModelSource,
  initialImageMaterial,
  initialPromptMaterial,
}: Props) {
  const wb = useImageWorkbench(credits);
  // 解构稳定回调（hook 内部均为稳定引用），避免依赖 wb 对象导致下游 memo 失效
  const {
    submit,
    selectConversation: wbSelectConversation,
    startNewDraft,
    loadMoreTurns,
    stopGeneration,
    remove,
    clearAll,
    setSearch,
  } = wb;
  const initialReference =
    initialImageMaterial?.url ||
    (initialPromptMaterial?.promptMeta?.mode === "edit"
      ? initialPromptMaterial.thumbnailUrl || initialPromptMaterial.url
      : "") ||
    "";
  const initialReferenceTitle =
    initialImageMaterial?.title || initialPromptMaterial?.title || "reference";

  // 创作台输入状态（受控）
  const [mode, setMode] = useState<"generate" | "edit">(
    initialReference ? "edit" : initialMode
  );
  const [prompt, setPrompt] = useState(initialPrompt);
  const [ratio, setRatio] = useState(initialRatio || "1:1");
  const [quality, setQuality] = useState(qualityValue(initialQuality));
  const [count, setCount] = useState(Math.min(10, Math.max(1, Math.floor(initialCount ?? 1))));
  const initialModelOption =
    findModuleModelOption(modelOptions, initialModel, initialModelSource) ??
    findModuleModelOption(modelOptions, initialModel) ??
    modelOptions[0];
  const [modelValue, setModelValue] = useState(initialModelOption?.value ?? "");
  const selectedModel =
    modelOptions.find((option) => option.value === modelValue) ?? modelOptions[0];
  const useOwnKey = selectedModel?.source === "user";
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<ReferencePreview[]>([]);
  const [conversationOpen, setConversationOpen] = useState(false);

  const addFiles = useCallback(async (picked: File[]) => {
    const images = picked.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    try {
      const previews = await Promise.all(
        images.map(async (f) => ({ name: f.name, dataUrl: await readAsDataUrl(f) }))
      );
      setFiles((prev) => [...prev, ...images]);
      setReferences((prev) => [...prev, ...previews]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取参考图失败");
    }
  }, []);

  const addReferenceFromUrl = useCallback(
    async (url: string, title: string) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("无法读取素材");
        const blob = await res.blob();
        const ext = blob.type.split("/")[1] || "png";
        const file = new File([blob], `${title || "material"}.${ext}`, {
          type: blob.type || "image/png",
        });
        await addFiles([file]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "无法读取素材");
      }
    },
    [addFiles]
  );

  const addMaterial = useCallback(
    async (material: MaterialView) => {
      const meta = material.promptMeta;
      const promptText = material.promptText || material.description || "";
      if (promptText.trim()) setPrompt(promptText.trim().slice(0, 4000));
      const metaRatio = getStringMeta(meta, "ratio");
      if (metaRatio) setRatio(metaRatio);
      const metaQuality = getStringMeta(meta, "quality");
      if (metaQuality) setQuality(qualityValue(metaQuality));
      const metaCount = getNumberMeta(meta, "count");
      if (metaCount) setCount(Math.min(10, Math.max(1, Math.floor(metaCount))));
      const metaModel = getStringMeta(meta, "model");
      const rawMetaSource = getStringMeta(meta, "modelSource");
      const metaSource =
        rawMetaSource === "user" || rawMetaSource === "platform"
          ? rawMetaSource
          : undefined;
      const metaOption = findModuleModelOption(modelOptions, metaModel, metaSource);
      if (metaOption) setModelValue(metaOption.value);
      if (material.type === "PROMPT") {
        setMode(meta?.mode === "edit" ? "edit" : "generate");
        if (material.thumbnailUrl) {
          await addReferenceFromUrl(material.thumbnailUrl, material.title);
        }
        toast.success("已应用提示词素材");
        return;
      }

      setMode("edit");
      await addReferenceFromUrl(material.url, material.title);
      toast.success(promptText.trim() || meta ? "已应用素材参数并加入参考图" : "已加入参考图");
    },
    [addReferenceFromUrl, modelOptions]
  );

  const initialLoadedRef = useRef(false);
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;

    if (!initialReference) return;

    const timer = window.setTimeout(() => {
      void addReferenceFromUrl(initialReference, initialReferenceTitle);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addReferenceFromUrl, initialReference, initialReferenceTitle]);

  const removeReference = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setReferences((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearComposer = useCallback(() => {
    setPrompt("");
    setCount(1);
    setFiles([]);
    setReferences([]);
  }, []);

  const handlePickPreset = useCallback(
    (preset: ImagePreset) => {
      setMode(preset.referenceImageUrl ? "edit" : preset.mode);
      setPrompt(preset.prompt);
      if (preset.ratio) setRatio(preset.ratio);
      if (preset.referenceImageUrl) {
        void addReferenceFromUrl(preset.referenceImageUrl, preset.referenceTitle || preset.title);
      }
    },
    [addReferenceFromUrl]
  );

  // 以已生成的图继续编辑：拉取该图为 File 放入参考图
  const handleContinueEdit = useCallback(
    async (url: string) => {
      setMode("edit");
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const file = new File([blob], `reference-${Date.now()}.png`, { type: blob.type || "image/png" });
        await addFiles([file]);
        toast.success("已加入参考图，输入描述后即可编辑");
      } catch {
        toast.error("无法加载该图片作为参考图（可能跨域受限）");
      }
    },
    [addFiles]
  );

  const applyTurnInput = useCallback(
    (input: ReuseTurnInput) => {
      setPrompt(input.prompt);
      setMode(input.mode);
      setRatio(input.ratio || "1:1");
      setQuality(qualityValue(input.quality));
      setCount(Math.min(10, Math.max(1, Math.floor(input.count ?? 1))));
      const inputOption = findModuleModelOption(
        modelOptions,
        input.model,
        input.modelSource,
      );
      if (inputOption) setModelValue(inputOption.value);
    },
    [modelOptions]
  );

  const handleRegenerate = useCallback(
    async (input: ReuseTurnInput) => {
      applyTurnInput(input);
      if (input.mode === "edit") {
        toast.info("已回填图生图参数，请确认参考图后生成");
        return;
      }
      const regenerateModel =
        findModuleModelOption(modelOptions, input.model, input.modelSource) ??
        selectedModel;
      const ok = await submit({
        prompt: input.prompt.trim(),
        ratio: input.ratio || "1:1",
        quality: qualityValue(input.quality),
        count: Math.min(10, Math.max(1, Math.floor(input.count ?? 1))),
        model: regenerateModel?.model,
        modelSource: regenerateModel?.source,
        mode: "generate",
      });
      if (ok) toast.success("已按原参数重新生成");
    },
    [applyTurnInput, modelOptions, selectedModel, submit]
  );

  const handleGenerateSimilar = useCallback(
    async (url: string, input: ReuseTurnInput) => {
      applyTurnInput({ ...input, mode: "edit", count: 1 });
      await handleContinueEdit(url);
      toast.success("已加入参考图并回填参数，可直接生成相似图");
    },
    [applyTurnInput, handleContinueEdit]
  );

  const handleOptimizePrompt = useCallback(async (request: PromptOptimizeRequest): Promise<PromptOptimizationResult> => {
    const text = prompt.trim();
    if (!text) {
      throw new Error("请先输入提示词");
    }
    const res = await fetch("/api/image/prompt/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: text,
        mode,
        ratio,
        optimizeMode: request.optimizeMode,
        instruction: request.instruction,
        currentPrompt: request.currentPrompt,
        messages: request.messages,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "提示词优化失败");
    if (typeof data.prompt !== "string" || !data.prompt.trim()) {
      throw new Error("提示词优化失败");
    }
    return {
      prompt: data.prompt.trim().slice(0, 4000),
      reply: typeof data.reply === "string" ? data.reply : undefined,
      explanation: typeof data.explanation === "string" ? data.explanation : undefined,
      negativePrompt: typeof data.negativePrompt === "string" ? data.negativePrompt : undefined,
      suggestedRatio: typeof data.suggestedRatio === "string" ? data.suggestedRatio : undefined,
      suggestedQuality: typeof data.suggestedQuality === "string" ? data.suggestedQuality : undefined,
      suggestedCount: typeof data.suggestedCount === "number" ? data.suggestedCount : undefined,
      fallback: Boolean(data.fallback),
    };
  }, [mode, prompt, ratio]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("请输入提示词");
      return;
    }
    if (mode === "edit" && files.length === 0) {
      toast.error("请先上传参考图");
      return;
    }

    let referenceThumb: string | undefined;
    if (mode === "edit" && files[0]) {
      try {
        referenceThumb = await fileToThumbnail(files[0]);
      } catch {
        referenceThumb = undefined;
      }
    }

    const ok = await submit({
      prompt: prompt.trim(),
      ratio,
      quality,
      count,
      model: selectedModel?.model,
      modelSource: selectedModel?.source,
      mode,
      image: mode === "edit" ? files[0] : undefined,
      referenceThumb,
    });

    if (ok) clearComposer();
  }, [prompt, mode, files, ratio, quality, count, selectedModel, submit, clearComposer]);

  const selectConversation = useCallback(
    (id: string) => {
      void wbSelectConversation(id);
      setConversationOpen(false);
    },
    [wbSelectConversation]
  );

  const startNewConversation = useCallback(() => {
    startNewDraft();
    setConversationOpen(false);
  }, [startNewDraft]);

  const renderConversationSidebar = () => (
    <ConversationSidebar
      conversations={wb.conversations}
      activeId={wb.activeId}
      search={wb.search}
      loading={wb.loadingList}
      loadingMore={wb.loadingMoreConversations}
      hasMore={wb.hasMoreConversations}
      balance={wb.balance}
      useOwnKey={useOwnKey}
      onSearch={setSearch}
      onSelect={selectConversation}
      onNew={startNewConversation}
      onDelete={remove}
      onClear={clearAll}
      onLoadMore={wb.loadMoreConversations}
    />
  );

  return (
    <div className="grid flex-1 grid-cols-1 gap-4 md:min-h-0 md:overflow-hidden md:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[260px_minmax(0,1fr)_360px]">
      <Card className="hidden min-h-0 overflow-hidden p-3 2xl:block">
        {renderConversationSidebar()}
      </Card>

      <Card className="min-h-0 min-w-0 gap-0 overflow-hidden p-4">
        <div className="mb-3 flex items-center justify-between gap-2 2xl:hidden">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConversationOpen(true)}
          >
            <MessageSquare className="size-4" />
            会话
          </Button>
          <div className="truncate text-xs text-muted-foreground">
            {wb.detail?.title || (wb.activeId ? "当前会话" : "新会话")}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <ResultStream
            detail={wb.detail}
            loading={wb.loadingDetail}
            loadingMore={wb.loadingMoreTurns}
            onLoadMore={loadMoreTurns}
            onContinueEdit={handleContinueEdit}
            onReusePrompt={setPrompt}
            onRegenerate={handleRegenerate}
            onGenerateSimilar={handleGenerateSimilar}
            stoppingTurnIds={wb.stoppingTurnIds}
            onStopTurn={wb.stopTurn}
          />
        </div>
      </Card>

      <Card className="min-h-0 overflow-visible p-4 md:max-h-full md:self-stretch md:overflow-hidden 2xl:self-start">
        <PromptComposer
          mode={mode}
          prompt={prompt}
          ratio={ratio}
          quality={quality}
          count={count}
          modelValue={selectedModel?.value ?? ""}
          modelOptions={modelOptions}
          references={references}
          submitting={wb.submitting}
          stopping={wb.stopping}
          unitCost={unitCost}
          onModeChange={setMode}
          onPromptChange={setPrompt}
          onRatioChange={setRatio}
          onQualityChange={setQuality}
          onCountChange={setCount}
          onModelChange={setModelValue}
          onPickFiles={addFiles}
          onPickMaterial={addMaterial}
          onRemoveReference={removeReference}
          onPickPreset={handlePickPreset}
          onSubmit={handleSubmit}
          onStop={stopGeneration}
          onOptimizePrompt={handleOptimizePrompt}
        />
      </Card>

      <Dialog open={conversationOpen} onOpenChange={setConversationOpen}>
        <DialogContent className="left-0 top-0 h-dvh max-h-dvh w-[min(22rem,calc(100vw-1rem))] max-w-none grid-rows-[auto_minmax(0,1fr)] translate-x-0 translate-y-0 rounded-none rounded-r-xl p-4 sm:left-0 sm:top-0 sm:max-w-none sm:translate-x-0 sm:translate-y-0 2xl:hidden">
          <DialogTitle>会话管理</DialogTitle>
          <DialogDescription className="sr-only">
            新建、搜索、切换或删除图片创作会话。
          </DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden">
            {renderConversationSidebar()}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
