"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { useImageWorkbench } from "../hooks/use-image-workbench";
import { ConversationSidebar } from "./conversation-sidebar";
import { ResultStream } from "./result-stream";
import { PromptComposer, type ReferencePreview } from "./prompt-composer";
import { fileToThumbnail } from "../thumbnail";
import type { ImagePreset } from "@/lib/image-presets";
import type { MaterialView } from "@/components/materials/material-types";

interface Props {
  unitCost: number;
  credits: number;
  useOwnKey: boolean;
  defaultModel: string;
  models: string[];
  initialPrompt?: string;
  initialMode?: "generate" | "edit";
  initialRatio?: string;
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

export function ImageWorkbench({
  unitCost,
  credits,
  useOwnKey,
  defaultModel,
  models,
  initialPrompt = "",
  initialMode = "generate",
  initialRatio,
  initialImageMaterial,
  initialPromptMaterial,
}: Props) {
  const wb = useImageWorkbench(credits);
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
  const [quality, setQuality] = useState("standard");
  const [count, setCount] = useState(1);
  const [model, setModel] = useState(defaultModel);
  const [files, setFiles] = useState<File[]>([]);
  const [references, setReferences] = useState<ReferencePreview[]>([]);

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
      await addReferenceFromUrl(material.url, material.title);
    },
    [addReferenceFromUrl]
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

    const ok = await wb.submit({
      prompt: prompt.trim(),
      ratio,
      quality,
      count,
      model: model || undefined,
      mode,
      image: mode === "edit" ? files[0] : undefined,
      referenceThumb,
    });

    if (ok) clearComposer();
  }, [prompt, mode, files, ratio, quality, count, model, wb, clearComposer]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)_360px]">
      <Card className="hidden min-h-0 overflow-hidden p-3 lg:block">
        <ConversationSidebar
          conversations={wb.conversations}
          activeId={wb.activeId}
          search={wb.search}
          loading={wb.loadingList}
          balance={wb.balance}
          useOwnKey={useOwnKey}
          onSearch={wb.setSearch}
          onSelect={wb.selectConversation}
          onNew={wb.startNewDraft}
          onDelete={wb.remove}
          onClear={wb.clearAll}
        />
      </Card>

      <Card className="min-h-0 min-w-0 overflow-hidden p-4">
          <ResultStream
            detail={wb.detail}
            loading={wb.loadingDetail}
            loadingMore={wb.loadingMoreTurns}
            onLoadMore={wb.loadMoreTurns}
            onContinueEdit={handleContinueEdit}
            onReusePrompt={(p) => setPrompt(p)}
          />
      </Card>

      <Card className="min-h-0 overflow-hidden p-4">
        <PromptComposer
          mode={mode}
          prompt={prompt}
          ratio={ratio}
          quality={quality}
          count={count}
          model={model}
          models={models}
          references={references}
          submitting={wb.submitting}
          useOwnKey={useOwnKey}
          unitCost={unitCost}
          onModeChange={setMode}
          onPromptChange={setPrompt}
          onRatioChange={setRatio}
          onQualityChange={setQuality}
          onCountChange={setCount}
          onModelChange={setModel}
          onPickFiles={addFiles}
          onPickMaterial={addMaterial}
          onRemoveReference={removeReference}
          onPickPreset={handlePickPreset}
          onSubmit={handleSubmit}
        />
      </Card>
    </div>
  );
}
