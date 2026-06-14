"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";

interface SlidePreview {
  filename: string;
  url: string;
}

interface TextNode {
  index: number;
  text: string;
}

export function SlideTextEditor({ projectId, slides }: { projectId: string; slides: SlidePreview[] }) {
  const router = useRouter();
  const [selectedSlide, setSelectedSlide] = useState(slides[0]?.filename || "");
  const [texts, setTexts] = useState<TextNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [reexporting, startReexport] = useTransition();

  async function loadTexts(slide = selectedSlide) {
    if (!slide) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/slides/${encodeURIComponent(slide)}/texts`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "读取文本失败");
      setTexts(data.texts || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取文本失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveTexts() {
    if (!selectedSlide) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/slides/${encodeURIComponent(selectedSlide)}/texts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "保存失败");
      toast.success("文本已保存。");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  function reexport() {
    startReexport(async () => {
      try {
        const res = await fetch(`/api/ppt/projects/${projectId}/reexport`, { method: "POST" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "重新导出失败");
        toast.success("PPTX 已重新导出。");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重新导出失败");
      }
    });
  }

  if (slides.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
        <div className="space-y-2">
          <Label>选择页面</Label>
          <Select
            value={selectedSlide}
            onValueChange={(value) => {
              setSelectedSlide(value);
              setTexts([]);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {slides.map((slide, index) => (
                <SelectItem key={slide.filename} value={slide.filename}>
                  第 {index + 1} 页 · {slide.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => loadTexts()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : null}
          读取文本
        </Button>
        <Button type="button" onClick={reexport} disabled={reexporting}>
          {reexporting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          重新导出
        </Button>
      </div>

      {texts.length > 0 && (
        <div className="space-y-3">
          {texts.map((item, index) => (
            <div key={item.index} className="space-y-2">
              <Label>文本 {index + 1}</Label>
              <Textarea
                value={item.text}
                rows={Math.min(5, Math.max(2, item.text.split("\n").length))}
                onChange={(event) =>
                  setTexts((prev) =>
                    prev.map((text) => text.index === item.index ? { ...text, text: event.target.value } : text)
                  )
                }
              />
            </div>
          ))}
          <Button type="button" onClick={saveTexts} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存文本
          </Button>
        </div>
      )}
    </div>
  );
}
