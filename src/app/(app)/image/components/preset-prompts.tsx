"use client";

import { useEffect, useState } from "react";
import { FileText, Images, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IMAGE_PRESETS, type ImagePreset } from "@/lib/image-presets";
import type { MaterialView } from "@/components/materials/material-types";

interface Props {
  onPick: (preset: ImagePreset) => void;
}

function promptMaterialToPreset(material: MaterialView): ImagePreset {
  const meta = material.promptMeta || {};
  const mode = meta.mode === "edit" ? "edit" : "generate";
  const ratio = typeof meta.ratio === "string" ? meta.ratio : undefined;
  return {
    id: material.id,
    title: material.title,
    description: material.description || material.ownerName,
    prompt: material.promptText || "",
    mode,
    ratio: ratio as ImagePreset["ratio"],
    referenceImageUrl: mode === "edit" ? material.thumbnailUrl || undefined : undefined,
    referenceTitle: material.title,
  };
}

function PromptMaterialList({
  scope,
  onPick,
  onClose,
}: {
  scope: "mine" | "square";
  onPick: (preset: ImagePreset) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MaterialView[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ scope });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/materials/prompts?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "读取提示词失败");
        setItems(data.materials);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, scope]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="搜索提示词" />
      </div>
      <div className="max-h-[52vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileText className="size-9 opacity-50" />
            <p>{scope === "mine" ? "还没有保存提示词" : "暂无公开提示词"}</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => {
              const preset = promptMaterialToPreset(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onPick(preset);
                    onClose();
                  }}
                  className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-left transition hover:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{item.title}</span>
                    <Badge variant={preset.mode === "edit" ? "secondary" : "default"} className="ml-auto shrink-0">
                      {preset.mode === "edit" ? "图生图" : "文生图"}
                    </Badge>
                  </div>
                  <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                    {item.promptText || item.description || "提示词"}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function PresetPrompts({ onPick }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-center">
          <Images className="size-4" /> 选择预设
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>提示词预设</DialogTitle>
          <DialogDescription>
            选择后会填入提示词，并按预设切换文生图或图生图。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="official">
          <TabsList>
            <TabsTrigger value="official">官方预设</TabsTrigger>
            <TabsTrigger value="mine">我的提示词</TabsTrigger>
            <TabsTrigger value="square">素材广场</TabsTrigger>
          </TabsList>
          <TabsContent value="official" className="mt-4">
            <div className="grid max-h-[52vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {IMAGE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onPick(p);
                    setOpen(false);
                  }}
                  className="flex flex-col gap-1 rounded-lg border bg-background p-3 text-left transition hover:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{p.title}</span>
                    <Badge variant={p.mode === "edit" ? "secondary" : "default"} className="ml-auto shrink-0">
                      {p.mode === "edit" ? "图生图" : "文生图"}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                </button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="mine" className="mt-4">
            <PromptMaterialList scope="mine" onPick={onPick} onClose={() => setOpen(false)} />
          </TabsContent>
          <TabsContent value="square" className="mt-4">
            <PromptMaterialList scope="square" onPick={onPick} onClose={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
