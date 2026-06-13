"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { BookmarkPlus, Clipboard, CopyPlus, FileText, Heart, ImageIcon, Library, MoreHorizontal, Pencil, Send, Sparkles, Trash2, Eye, Lock } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteMaterialAction,
  makeMaterialPrivateAction,
  requestMaterialReviewAction,
  savePromptMaterialCopyAction,
  toggleFavoriteMaterialAction,
  toggleLikeMaterialAction,
} from "@/app/(app)/materials/actions";
import type { MaterialView } from "./material-types";
import { PromptMaterialForm } from "./prompt-material-form";
import { isOptimizableImageUrl } from "@/lib/utils";

const STATUS_LABEL: Record<MaterialView["status"], string> = {
  DRAFT: "私有",
  PENDING_REVIEW: "审核中",
  APPROVED: "已公开",
  REJECTED: "未通过",
  ARCHIVED: "已下架",
};

interface Props {
  material: MaterialView;
  mode: "square" | "library" | "picker";
  onPick?: (material: MaterialView) => void;
}

export function MaterialCard({ material, mode, onPick }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const isImage = material.type === "IMAGE";
  const isPrompt = material.type === "PROMPT";
  const promptText = material.promptText || "";
  const modeMeta = material.promptMeta?.mode === "edit" ? "edit" : "generate";
  const ratioMeta = typeof material.promptMeta?.ratio === "string" ? material.promptMeta.ratio : "";
  const qualityMeta = typeof material.promptMeta?.quality === "string" ? material.promptMeta.quality : "";
  const countMeta = typeof material.promptMeta?.count === "number" ? String(material.promptMeta.count) : "";
  const modelMeta = typeof material.promptMeta?.model === "string" ? material.promptMeta.model : "";
  const metaQuery = [
    `mode=${encodeURIComponent(modeMeta)}`,
    ratioMeta ? `ratio=${encodeURIComponent(ratioMeta)}` : "",
    qualityMeta ? `quality=${encodeURIComponent(qualityMeta)}` : "",
    countMeta ? `count=${encodeURIComponent(countMeta)}` : "",
    modelMeta ? `model=${encodeURIComponent(modelMeta)}` : "",
  ].filter(Boolean).join("&");
  const usePromptHref = `/image?promptMaterialId=${encodeURIComponent(material.id)}&${metaQuery}`;
  const useImageHref = `/image?materialId=${encodeURIComponent(material.id)}&mode=edit${ratioMeta ? `&ratio=${encodeURIComponent(ratioMeta)}` : ""}${qualityMeta ? `&quality=${encodeURIComponent(qualityMeta)}` : ""}${modelMeta ? `&model=${encodeURIComponent(modelMeta)}` : ""}`;

  function runAction(action: () => Promise<{ ok?: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
      else toast.success(message);
    });
  }

  async function copyPrompt() {
    if (!promptText) return;
    try {
      await navigator.clipboard.writeText(promptText);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <>
      <article className="overflow-hidden rounded-lg border bg-card">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="relative block aspect-[4/3] w-full bg-muted outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={`查看素材：${material.title}`}
        >
          {isImage ? (
            <Image
              src={material.thumbnailUrl || material.url}
              alt={material.title}
              fill
              unoptimized={!isOptimizableImageUrl(material.thumbnailUrl || material.url)}
              sizes="(min-width: 640px) 240px, 90vw"
              className="object-cover transition-transform hover:scale-[1.02]"
            />
          ) : isPrompt && material.thumbnailUrl ? (
            <Image
              src={material.thumbnailUrl}
              alt={material.title}
              fill
              unoptimized={!isOptimizableImageUrl(material.thumbnailUrl)}
              sizes="(min-width: 640px) 240px, 90vw"
              className="object-cover transition-transform hover:scale-[1.02]"
            />
          ) : isPrompt ? (
            <div className="flex h-full flex-col justify-between p-3 text-left">
              <FileText className="size-6 text-primary" />
              <p className="line-clamp-4 text-xs leading-5 text-muted-foreground">
                {promptText || material.description || "提示词"}
              </p>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <ImageIcon className="size-8" />
            </div>
          )}
        </button>

        <div className="space-y-2 p-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-medium">
                {material.status === "APPROVED" && material.visibility === "PUBLIC" ? (
                  <Link href={`/materials/${material.id}`} className="hover:underline">
                    {material.title}
                  </Link>
                ) : (
                  material.title
                )}
              </h3>
              {material.ownerType === "PLATFORM" && <Badge variant="secondary">官方</Badge>}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{material.ownerName}</p>
          </div>

          {material.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {material.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {mode === "library" && material.status === "REJECTED" && material.rejectionReason && (
            <p className="line-clamp-2 rounded-md bg-destructive/10 px-2 py-1 text-[11px] leading-4 text-destructive">
              未通过：{material.rejectionReason}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-1">
            {mode === "library" ? (
              <Badge variant={material.status === "APPROVED" ? "default" : "outline"}>
                {STATUS_LABEL[material.status]}
              </Badge>
            ) : !isPrompt ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  runAction(
                    () => toggleLikeMaterialAction(material.id),
                    material.liked ? "已取消点赞" : "已点赞"
                  )
                }
                className="h-7 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                title={material.liked ? "取消点赞" : "点赞"}
                aria-label={`${material.liked ? "取消点赞" : "点赞"}：${material.title}`}
              >
                <Heart className={`size-4 ${material.liked ? "fill-current text-rose-500" : ""}`} />
                <span className="text-xs">{material.likeCount}</span>
              </Button>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  runAction(
                    () => toggleLikeMaterialAction(material.id),
                    material.liked ? "已取消点赞" : "已点赞"
                  )
                }
                className="h-7 shrink-0 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
                title={material.liked ? "取消点赞" : "点赞"}
                aria-label={`${material.liked ? "取消点赞" : "点赞"}：${material.title}`}
              >
                <Heart className={`size-4 ${material.liked ? "fill-current text-rose-500" : ""}`} />
                <span className="text-xs">{material.likeCount}</span>
              </Button>
            )}

            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
              {mode === "picker" && (
                <Button size="xs" onClick={() => onPick?.(material)}>
                  <Library className="size-3" /> 使用
                </Button>
              )}
              {isPrompt && mode === "library" && (
                <Button size="xs" variant="outline" onClick={copyPrompt}>
                  <Clipboard className="size-3.5" /> 复制
                </Button>
              )}
              {isPrompt && mode !== "picker" && (
                <Button size="xs" className="shrink-0" asChild>
                  <Link href={usePromptHref}>使用</Link>
                </Button>
              )}
              {isImage && mode !== "picker" && (
                <Button size="xs" variant={mode === "square" ? "default" : "outline"} className="shrink-0" asChild>
                  <Link href={useImageHref}>
                    <Sparkles className="size-3" /> 创作
                  </Link>
                </Button>
              )}
              {mode === "square" && (
                <Button
                  size="xs"
                  variant={material.favorited ? "default" : "outline"}
                  disabled={pending}
                  onClick={() =>
                    runAction(
                      () => toggleFavoriteMaterialAction(material.id),
                      material.favorited ? "已取消收藏" : "已收藏"
                    )
                  }
                  title={material.favorited ? "取消收藏" : "收藏"}
                  aria-label={`${material.favorited ? "取消收藏" : "收藏"}：${material.title}`}
                >
                  <BookmarkPlus className="size-3" />
                  {material.favorited ? "已收藏" : "收藏"}
                </Button>
              )}
              {(mode === "library" || (mode === "square" && isPrompt)) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="outline" disabled={pending} aria-label={`更多操作：${material.title}`}>
                      <MoreHorizontal className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setPreviewOpen(true)}>
                      <Eye className="size-4" /> 查看
                    </DropdownMenuItem>
                    {material.status === "APPROVED" && material.visibility === "PUBLIC" && (
                      <DropdownMenuItem asChild>
                        <Link href={`/materials/${material.id}`}>
                          <FileText className="size-4" /> 详情
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {isImage && (
                      <DropdownMenuItem asChild>
                        <Link href={useImageHref}>
                          <Sparkles className="size-4" /> 用作参考图
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {isPrompt && (
                      <DropdownMenuItem asChild>
                        <Link href={usePromptHref}>
                          <Sparkles className="size-4" /> 使用到创作台
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {isPrompt && (
                      <DropdownMenuItem onClick={copyPrompt}>
                        <Clipboard className="size-4" /> 复制
                      </DropdownMenuItem>
                    )}
                    {isPrompt && mode === "square" && (
                      <DropdownMenuItem
                        onClick={() =>
                          runAction(
                            () => savePromptMaterialCopyAction(material.id),
                            "已保存到我的提示词"
                          )
                        }
                      >
                        <CopyPlus className="size-4" /> 保存到我的素材库
                      </DropdownMenuItem>
                    )}
                    {mode === "square" && (
                      <DropdownMenuItem
                        onClick={() =>
                          runAction(
                            () => toggleFavoriteMaterialAction(material.id),
                            material.favorited ? "已取消收藏" : "已收藏"
                          )
                        }
                      >
                        <BookmarkPlus className="size-4" />
                        {material.favorited ? "取消收藏" : "收藏"}
                      </DropdownMenuItem>
                    )}
                    {isPrompt && <DropdownMenuItem disabled>请用卡片下方编辑按钮修改提示词</DropdownMenuItem>}
                    {mode === "library" && (material.visibility === "PRIVATE" || material.status === "REJECTED") ? (
                      <DropdownMenuItem
                        onClick={() =>
                          runAction(
                            () => requestMaterialReviewAction(material.id),
                            "已提交分享"
                          )
                        }
                      >
                        <Send className="size-4" /> 分享到广场
                      </DropdownMenuItem>
                    ) : mode === "library" ? (
                      <DropdownMenuItem
                        onClick={() =>
                          runAction(
                            () => makeMaterialPrivateAction(material.id),
                            "已转为私有"
                          )
                        }
                      >
                        <Lock className="size-4" /> 转为私有
                      </DropdownMenuItem>
                    ) : null}
                    {mode === "library" && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() =>
                          runAction(() => deleteMaterialAction(material.id), "已删除素材")
                        }
                      >
                        <Trash2 className="size-4" /> 删除
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          {isPrompt && mode === "library" && (
            <PromptMaterialForm
              material={material}
              trigger={
                <Button size="xs" variant="outline" className="w-full">
                  <Pencil className="size-3.5" /> 编辑提示词
                </Button>
              }
            />
          )}
        </div>
      </article>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-5xl">
          <DialogTitle className="sr-only">{material.title}</DialogTitle>
          <DialogDescription className="sr-only">预览素材内容。</DialogDescription>
          <div className="flex max-h-[calc(100vh-5rem)] items-center justify-center">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={material.url}
                alt={material.title}
                className="max-h-[calc(100vh-5rem)] max-w-full rounded-md object-contain"
              />
            ) : isPrompt ? (
              <div className="max-h-[calc(100vh-5rem)] w-full max-w-3xl space-y-4 overflow-y-auto p-4">
                {material.thumbnailUrl && (
                  <div className="overflow-hidden rounded-lg border bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={material.thumbnailUrl}
                      alt={`${material.title} 参考图`}
                      className="max-h-80 w-full object-contain"
                    />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold">{material.title}</h3>
                  {material.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{material.description}</p>
                  )}
                </div>
                <pre className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm leading-6">
                  {promptText}
                </pre>
                <div className="flex justify-end">
                  <Button onClick={copyPrompt}>
                    <Clipboard className="size-4" /> 复制提示词
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-12 text-muted-foreground">暂不支持预览该类型素材</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
