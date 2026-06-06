"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { ASPECT_RATIOS } from "@/lib/providers/types";
import type { MaterialView } from "./material-types";

interface Props {
  material?: MaterialView;
  trigger?: React.ReactNode;
}

export function PromptMaterialForm({ material, trigger }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">(
    material?.visibility === "PUBLIC" ? "PUBLIC" : "PRIVATE"
  );
  const [mode, setMode] = useState<"generate" | "edit">(
    material?.promptMeta?.mode === "edit" ? "edit" : "generate"
  );
  const [ratio, setRatio] = useState(
    typeof material?.promptMeta?.ratio === "string" ? material.promptMeta.ratio : "1:1"
  );
  const [preview, setPreview] = useState<string | null>(material?.thumbnailUrl || null);

  function handleFile(file?: File) {
    if (!file) {
      setPreview(material?.thumbnailUrl || null);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      try {
        if (material) formData.set("id", material.id);
        formData.set("visibility", visibility);
        formData.set("mode", mode);
        formData.set("ratio", ratio);
        const res = await fetch("/api/materials/prompts", {
          method: material ? "PATCH" : "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || "保存失败");
          return;
        }
        toast.success(
          visibility === "PUBLIC"
            ? material
              ? "提示词已更新并提交审核"
              : "提示词已提交审核"
            : material
              ? "提示词已更新"
              : "提示词已保存"
        );
        setOpen(false);
        if (!material) {
          setPreview(null);
          if (fileRef.current) fileRef.current.value = "";
        }
        router.refresh();
      } catch {
        toast.error("保存失败");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <FileText className="size-4" /> 新建提示词
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>{material ? "编辑提示词" : "新建提示词"}</DialogTitle>
          <DialogDescription>
            可上传一张参考图作为提示词封面，方便在素材广场和预设里识别效果。
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prompt-title">标题</Label>
                <Input id="prompt-title" name="title" required maxLength={80} defaultValue={material?.title || ""} />
              </div>
              <div className="space-y-2">
                <Label>可见性</Label>
                <Select value={visibility} onValueChange={(value) => setVisibility(value as "PRIVATE" | "PUBLIC")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIVATE">仅自己可见</SelectItem>
                    <SelectItem value="PUBLIC">提交分享到广场</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>模式</Label>
                <Select value={mode} onValueChange={(value) => setMode(value as "generate" | "edit")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generate">文生图</SelectItem>
                    <SelectItem value="edit">图生图</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>推荐比例</Label>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt-text">提示词</Label>
              <Textarea
                id="prompt-text"
                name="promptText"
                required
                rows={4}
                maxLength={4000}
                defaultValue={material?.promptText || ""}
              />
            </div>
            <div className="space-y-2">
              <Label>参考图 / 封面图</Label>
              <div className="relative flex h-32 w-full items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground transition hover:bg-muted/80">
                <input
                  ref={fileRef}
                  id="prompt-reference"
                  name="referenceImage"
                  type="file"
                  accept="image/*"
                  aria-label="上传提示词参考图"
                  className="absolute inset-0 z-10 cursor-pointer opacity-0"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="提示词参考图" className="size-full object-contain" />
                ) : (
                  <span className="flex items-center gap-2 text-sm">
                    <ImagePlus className="size-5" /> 点击上传参考图
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-tags">标签</Label>
              <Input
                id="prompt-tags"
                name="tags"
                placeholder="用空格或逗号分隔"
                maxLength={200}
                defaultValue={material?.tags.join(" ") || ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-desc">说明</Label>
              <Textarea
                id="prompt-desc"
                name="description"
                rows={2}
                maxLength={400}
                defaultValue={material?.description || ""}
              />
            </div>
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-5 py-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
