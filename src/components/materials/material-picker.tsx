"use client";

import { useEffect, useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialCard } from "./material-card";
import type { MaterialView } from "./material-types";

interface Props {
  onPick: (material: MaterialView) => void;
}

export function MaterialPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"mine" | "favorites" | "square">("mine");
  const [loading, setLoading] = useState(false);
  const [materials, setMaterials] = useState<MaterialView[]>([]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ scope });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/materials/mine?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "读取素材失败");
        setMaterials(data.materials);
      } catch (e) {
        if (!controller.signal.aborted) {
          toast.error(e instanceof Error ? e.message : "读取素材失败");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, q, scope]);

  function handlePick(material: MaterialView) {
    onPick(material);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <ImageIcon className="size-4" /> 从素材库选择
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>选择素材</DialogTitle>
          <DialogDescription className="sr-only">
            从我的素材库或收藏素材中选择一张图片作为参考图。
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" placeholder="搜索我的素材" />
        </div>
        <Tabs value={scope} onValueChange={(value) => setScope(value as "mine" | "favorites" | "square")}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="mine">我的素材</TabsTrigger>
            <TabsTrigger value="favorites">收藏</TabsTrigger>
            <TabsTrigger value="square">素材广场</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="正在加载素材">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="overflow-hidden rounded-lg border bg-card">
                  <Skeleton className="aspect-[4/3] rounded-none" />
                  <div className="space-y-2 p-2.5">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-1/2" />
                    <div className="flex justify-between gap-2 pt-1">
                      <Skeleton className="h-6 w-12" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : materials.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-muted-foreground">
              <ImageIcon className="size-10 opacity-50" />
              <p className="text-sm font-medium">暂无可用素材</p>
              <p className="max-w-xs text-xs">换个关键词搜索，或先去素材库上传图片。</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {materials.map((material) => (
                <MaterialCard key={material.id} material={material} mode="picker" onPick={handlePick} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
