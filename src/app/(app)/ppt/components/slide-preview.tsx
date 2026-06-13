"use client";

import Image from "next/image";
import { memo, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GORDEN_PPT_TEMPLATES, type PptSlideContent, type SerializedPptProject } from "@/lib/ppt-shared";
import { cn, isOptimizableImageUrl } from "@/lib/utils";

const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;

function getSlidePreviewDensity(slide: PptSlideContent) {
  const totalTextLength =
    slide.title.length +
    (slide.subtitle?.length ?? 0) +
    slide.bullets.reduce((sum, item) => sum + item.length, 0);
  if (totalTextLength > 180 || slide.bullets.length > 5) return "dense";
  if (totalTextLength > 110 || slide.bullets.length > 3) return "compact";
  return "normal";
}

export const SlidePreview = memo(function SlidePreview({
  slide,
  project,
}: {
  slide: PptSlideContent;
  project: SerializedPptProject;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [previewOpen, setPreviewOpen] = useState(false);
  const density = getSlidePreviewDensity(slide);
  const visualImageUrl = slide.imageStatus === "SUCCESS" && slide.imageUrl ? slide.imageUrl : "";
  const hasVisualImage = Boolean(visualImageUrl);
  const hasBullets = slide.bullets.length > 0;
  const titleSize = density === "dense" ? 38 : density === "compact" ? 46 : 54;
  const subtitleSize = density === "dense" ? 22 : 26;
  const bulletSize = density === "dense" ? 21 : density === "compact" ? 23 : 25;
  const columns = slide.bullets.length > 1 ? "repeat(2, minmax(0, 1fr))" : "1fr";
  const template = project.generationMode === "TEMPLATE" ? "" : project.template;
  const gordenTemplate = project.generationMode === "TEMPLATE"
    ? GORDEN_PPT_TEMPLATES.find((item) => item.value === project.template)
    : null;
  const isPitchLike =
    template === "PITCH_DECK" ||
    template === "PRODUCT_LAUNCH" ||
    gordenTemplate?.category === "business" ||
    gordenTemplate?.category === "operations" ||
    gordenTemplate?.category === "career";
  const isReportLike =
    template === "CONSULTING" ||
    template === "RESEARCH" ||
    gordenTemplate?.category === "consulting" ||
    gordenTemplate?.category === "data" ||
    gordenTemplate?.category === "architecture";
  const isTraining = template === "TRAINING" || gordenTemplate?.category === "training" || gordenTemplate?.category === "thesis";

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;

    const update = (width: number) => {
      setScale(Math.min(1, Math.max(0.25, width / PREVIEW_WIDTH)));
    };
    update(node.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) update(width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (hasVisualImage) {
    return (
      <div ref={frameRef} className="mx-auto w-full max-w-3xl space-y-3">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="group relative aspect-video w-full overflow-hidden rounded-lg border bg-slate-50 shadow-sm outline-none ring-offset-background transition hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label="放大预览 PPT 页面"
        >
          <Image
            src={visualImageUrl}
            alt={slide.title}
            fill
            unoptimized={!isOptimizableImageUrl(visualImageUrl)}
            loading="eager"
            sizes="(min-width: 1280px) 760px, 100vw"
            className="object-contain"
          />
          <span className="absolute bottom-3 right-3 rounded-full bg-background/90 px-3 py-1 text-xs text-foreground opacity-0 shadow-sm transition group-hover:opacity-100">
            点击放大
          </span>
        </button>
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-3 sm:max-w-6xl">
            <DialogTitle className="sr-only">{slide.title}</DialogTitle>
            <DialogDescription className="sr-only">放大预览 PPT 页面。</DialogDescription>
            <div className="relative h-[min(85vh,calc((100vw-2rem)*9/16))] w-[min(90vw,calc((100vh-2rem)*16/9))] overflow-hidden rounded-md bg-slate-50">
              <Image
                src={visualImageUrl}
                alt={slide.title}
                fill
                unoptimized={!isOptimizableImageUrl(visualImageUrl)}
                sizes="90vw"
                className="object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">AI 视觉图</Badge>
          {slide.imageModel && <span>模型：{slide.imageModel}</span>}
          {typeof slide.imageDurationMs === "number" && <span>耗时：{Math.round(slide.imageDurationMs / 1000)} 秒</span>}
        </div>
        {slide.speakerNotes && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">演讲备注：</span>
            {slide.speakerNotes}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={frameRef} className="mx-auto w-full max-w-3xl space-y-3">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg border bg-white shadow-sm"
        style={{ color: `#${project.theme.foreground}`, background: `#${project.theme.background}` }}
      >
        {isPitchLike && (
          <>
            <div
              className="absolute -right-[120px] -top-[120px] h-[330px] w-[330px] rounded-full opacity-80"
              style={{ background: `#${project.theme.primary}` }}
            />
            <div
              className="absolute -bottom-[100px] right-[40px] h-[250px] w-[250px] rounded-full opacity-50"
              style={{ background: `#${project.theme.secondary}` }}
            />
          </>
        )}
        {isReportLike && (
          <>
            <div className="absolute left-0 top-0 h-full w-[10px]" style={{ background: `#${project.theme.primary}` }} />
            <div className="absolute left-[56px] right-[56px] top-[114px] h-px bg-slate-300" />
          </>
        )}
        {isTraining && (
          <div className="absolute inset-[28px] rounded-[18px] border bg-white/70" />
        )}
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            color: `#${project.theme.foreground}`,
            background: `#${project.theme.background}`,
          }}
        >
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              density === "dense" ? "p-[48px]" : "p-[64px]",
              isPitchLike && "max-w-[690px]",
              isReportLike && "pl-[72px]",
              isTraining && "p-[72px]"
            )}
          >
            <div
              className={cn("h-[10px] shrink-0", isReportLike ? "w-[90px] rounded-none" : "w-[140px] rounded-full")}
              style={{ background: `#${project.theme.primary}` }}
            />
            <div
              className="mt-[36px] text-[22px] font-semibold uppercase"
              style={{ color: `#${project.theme.muted}` }}
            >
              {String(slide.order).padStart(2, "0")} · {slide.layout}
            </div>
            <h2
              className="mt-[16px] break-words font-bold"
              style={{ fontSize: titleSize, lineHeight: 1.08 }}
            >
              {slide.title}
            </h2>
            {slide.subtitle && (
              <p
                className="mt-[18px] break-words"
                style={{ color: `#${project.theme.muted}`, fontSize: subtitleSize, lineHeight: 1.25 }}
              >
                {slide.subtitle}
              </p>
            )}
            {hasBullets && (
              <div
                className="mt-[34px] grid min-h-0 flex-1 content-start gap-[18px] overflow-hidden"
                style={{ gridTemplateColumns: isTraining ? "1fr" : columns }}
              >
                {slide.bullets.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className={cn(
                      "min-w-0 rounded-[10px] border bg-white/70 px-[20px] py-[16px] shadow-xs",
                      isReportLike && "rounded-none border-x-0 border-b border-t-0 bg-white/40 shadow-none",
                      isTraining && "rounded-[14px] bg-white"
                    )}
                    style={{ fontSize: bulletSize, lineHeight: 1.22 }}
                  >
                    <span className="mr-[10px] font-bold" style={{ color: `#${project.theme.primary}` }}>
                      {index + 1}
                    </span>
                    <span className="break-words">{item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">文字版预览</Badge>
        {slide.imageStatus === "FAILED" && slide.imageError && <span className="text-destructive">{slide.imageError}</span>}
      </div>
      {slide.speakerNotes && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">演讲备注：</span>
          {slide.speakerNotes}
        </div>
      )}
    </div>
  );
});
