"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Upload } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function MaterialUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [pending, startTransition] = useTransition();

  function handleFile(file?: File) {
    if (!file) {
      setPreview(null);
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
        formData.set("visibility", visibility);
        const res = await fetch("/api/materials/upload", {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || "上传失败");
          return;
        }
        toast.success(
          visibility === "PUBLIC"
            ? data.status === "APPROVED"
              ? "素材已上传并公开"
              : data.status === "REJECTED"
                ? "素材已上传，自动审核未通过"
                : "素材已上传并提交审核"
            : "素材已上传"
        );
        setOpen(false);
        setPreview(null);
        setVisibility("PRIVATE");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch {
        toast.error("上传失败");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="size-4" /> 上传素材
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>上传图片素材</DialogTitle>
          <DialogDescription className="sr-only">
            上传图片到个人素材库，可后续提交审核分享到素材广场。
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="material-file">图片</Label>
            <Input
              ref={fileRef}
              id="material-file"
              name="file"
              type="file"
              accept="image/*"
              required
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {preview ? (
            <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="预览" className="size-full object-contain" />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted text-muted-foreground">
              <ImagePlus className="size-8" />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="material-title">名称</Label>
            <Input id="material-title" name="title" placeholder="素材名称" maxLength={80} />
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
          <div className="space-y-2">
            <Label htmlFor="material-tags">标签</Label>
            <Input id="material-tags" name="tags" placeholder="用空格或逗号分隔" maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-desc">描述</Label>
            <Textarea id="material-desc" name="description" rows={3} maxLength={400} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              上传
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
