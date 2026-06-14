"use client";

import { useTransition } from "react";
import { useState } from "react";
import Link from "next/link";
import { BookmarkPlus, Clipboard, CopyPlus, Flag, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  saveImageMaterialCopyAction,
  savePromptMaterialCopyAction,
  reportMaterialAction,
  toggleFavoriteMaterialAction,
  toggleLikeMaterialAction,
} from "@/app/(app)/materials/actions";
import type { MaterialView } from "./material-types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  material: MaterialView;
}

function promptHref(material: MaterialView) {
  if (
    material.promptMeta?.module === "PPT" ||
    material.promptMeta?.kind === "ppt-style" ||
    material.tags.includes("PPT风格") ||
    material.tags.includes("ppt-style")
  ) {
    return `/ppt?styleMaterialId=${encodeURIComponent(material.id)}`;
  }
  const mode = material.promptMeta?.mode === "edit" ? "edit" : "generate";
  const ratio =
    typeof material.promptMeta?.ratio === "string"
      ? `&ratio=${encodeURIComponent(material.promptMeta.ratio)}`
      : "";
  return `/image?promptMaterialId=${encodeURIComponent(material.id)}&mode=${mode}${ratio}`;
}

export function MaterialDetailActions({ material }: Props) {
  const [pending, startTransition] = useTransition();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const isPrompt = material.type === "PROMPT";
  const useHref = isPrompt
    ? promptHref(material)
    : `/image?materialId=${encodeURIComponent(material.id)}&mode=edit`;

  function run(action: () => Promise<{ ok?: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else toast.success(message);
    });
  }

  async function copyPrompt() {
    if (!material.promptText) return;
    try {
      await navigator.clipboard.writeText(material.promptText);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild>
        <Link href={useHref}>
          <Sparkles className="size-4" />
          {isPrompt
            ? material.promptMeta?.module === "PPT" ||
              material.promptMeta?.kind === "ppt-style" ||
              material.tags.includes("PPT风格") ||
              material.tags.includes("ppt-style")
              ? "用于 PPT"
              : "使用提示词"
            : "用作参考图"}
        </Link>
      </Button>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () => toggleLikeMaterialAction(material.id),
            material.liked ? "已取消点赞" : "已点赞"
          )
        }
      >
        <Heart className={`size-4 ${material.liked ? "fill-current text-rose-500" : ""}`} />
        {material.likeCount}
      </Button>
      <Button
        variant={material.favorited ? "default" : "outline"}
        disabled={pending}
        onClick={() =>
          run(
            () => toggleFavoriteMaterialAction(material.id),
            material.favorited ? "已取消收藏" : "已收藏"
          )
        }
      >
        <BookmarkPlus className="size-4" />
        {material.favorited ? "已收藏" : "收藏"}
      </Button>
      {isPrompt && material.promptText && (
        <Button variant="outline" onClick={copyPrompt}>
          <Clipboard className="size-4" /> 复制提示词
        </Button>
      )}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              isPrompt
                ? savePromptMaterialCopyAction(material.id)
                : saveImageMaterialCopyAction(material.id),
            "已保存到我的素材库"
          )
        }
      >
        <CopyPlus className="size-4" /> 保存到我的素材库
      </Button>
      <Button variant="outline" disabled={pending} onClick={() => setReportOpen(true)}>
        <Flag className="size-4" /> 举报
      </Button>
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogTitle>举报素材</DialogTitle>
          <Textarea
            placeholder="请填写原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const res = await reportMaterialAction(material.id, reason);
                if (res.ok) {
                  setReportOpen(false);
                  setReason("");
                }
                return res;
              }, "已提交举报")
            }
          >
            提交
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
