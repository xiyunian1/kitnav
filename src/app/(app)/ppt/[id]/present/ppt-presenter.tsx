"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PptSlideContent, SerializedPptProject } from "@/lib/ppt-shared";

interface PptPresenterProps {
  project: SerializedPptProject;
}

const PRESENT_WIDTH = 1280;
const PRESENT_HEIGHT = 720;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hasVisual(slide: PptSlideContent) {
  return slide.imageStatus === "SUCCESS" && Boolean(slide.imageUrl);
}

function formatSlideNumber(value: number) {
  return String(value).padStart(2, "0");
}

export function PptPresenter({ project }: PptPresenterProps) {
  const slides = project.slides;
  const [index, setIndex] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(0.75);
  const stageRef = useRef<HTMLDivElement>(null);
  const slide = slides[index] ?? slides[0] ?? null;
  const nextSlide = slides[index + 1] ?? null;
  const canGoPrevious = index > 0;
  const canGoNext = index < slides.length - 1;

  useEffect(() => {
    const updateScale = () => {
      const node = stageRef.current;
      if (!node) return;
      const availableWidth = node.clientWidth;
      const availableHeight = node.clientHeight;
      setScale(Math.min(availableWidth / PRESENT_WIDTH, availableHeight / PRESENT_HEIGHT));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (stageRef.current) observer.observe(stageRef.current);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [notesOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setIndex((current) => clamp(current - 1, 0, slides.length - 1));
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        setIndex((current) => clamp(current + 1, 0, slides.length - 1));
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setNotesOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slides.length]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  }

  if (!slide) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950 text-slate-200">
        <Button variant="outline" asChild>
          <Link href="/ppt">
            <ArrowLeft className="size-4" />
            返回
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950 text-white">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/95 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" asChild className="text-white hover:bg-white/10 hover:text-white">
              <Link href="/ppt" aria-label="返回 PPT 工作台">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{project.title}</div>
              <div className="text-xs text-slate-400">
                {formatSlideNumber(index + 1)} / {formatSlideNumber(slides.length)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setNotesOpen((current) => !current)}
              aria-label="讲者备注"
              title="讲者备注"
            >
              <FileText className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
              title={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Button variant="ghost" size="icon-sm" asChild className="text-white hover:bg-white/10 hover:text-white">
              <a href={`/api/ppt/projects/${project.id}/export`} aria-label="导出 PPTX" title="导出 PPTX">
                <Download className="size-4" />
              </a>
            </Button>
          </div>
        </header>

        <section ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          <button
            type="button"
            className="absolute left-4 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30 md:flex"
            onClick={() => setIndex((current) => clamp(current - 1, 0, slides.length - 1))}
            disabled={!canGoPrevious}
            aria-label="上一页"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div
            className="overflow-hidden rounded-md shadow-2xl"
            style={{ width: PRESENT_WIDTH * scale, height: PRESENT_HEIGHT * scale }}
          >
            <div
              className="origin-top-left"
              style={{
                width: PRESENT_WIDTH,
                height: PRESENT_HEIGHT,
                transform: `scale(${scale})`,
              }}
            >
              <PresenterSlide slide={slide} project={project} />
            </div>
          </div>
          <button
            type="button"
            className="absolute right-4 top-1/2 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30 md:flex"
            onClick={() => setIndex((current) => clamp(current + 1, 0, slides.length - 1))}
            disabled={!canGoNext}
            aria-label="下一页"
          >
            <ChevronRight className="size-5" />
          </button>
        </section>

        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-white/10 bg-slate-950/95 px-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setIndex((current) => clamp(current - 1, 0, slides.length - 1))}
            disabled={!canGoPrevious}
          >
            <ChevronLeft className="size-4" />
            上一页
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/15 sm:w-56">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${((index + 1) / slides.length) * 100}%` }}
              />
            </div>
            <Badge variant="secondary" className="bg-white/10 text-white hover:bg-white/10">
              {slide.layout}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={() => setIndex((current) => clamp(current + 1, 0, slides.length - 1))}
            disabled={!canGoNext}
          >
            下一页
            <ChevronRight className="size-4" />
          </Button>
        </footer>
      </main>

      {notesOpen && (
        <aside className="hidden w-[360px] shrink-0 border-l border-white/10 bg-slate-900 p-4 text-slate-100 lg:block">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">讲者备注</h2>
            <Badge variant="outline" className="border-white/20 text-slate-200">
              {formatSlideNumber(index + 1)}
            </Badge>
          </div>
          <div className="mb-5 rounded-md border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs text-slate-400">当前页</div>
            <div className="text-sm font-medium leading-relaxed">{slide.title}</div>
            {slide.speakerNotes ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{slide.speakerNotes}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">暂无备注</p>
            )}
          </div>
          {nextSlide && (
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <div className="mb-2 text-xs text-slate-400">下一页</div>
              <div className="text-sm font-medium leading-relaxed">{nextSlide.title}</div>
              <div className="mt-3 overflow-hidden rounded bg-slate-950">
                <div className="origin-top-left scale-[0.28]">
                  <PresenterSlide slide={nextSlide} project={project} compact />
                </div>
                <div className="h-[202px]" />
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function PresenterSlide({
  slide,
  project,
  compact = false,
}: {
  slide: PptSlideContent;
  project: SerializedPptProject;
  compact?: boolean;
}) {
  const visual = hasVisual(slide) ? slide.imageUrl : "";
  const foreground = `#${project.theme.foreground}`;
  const background = `#${project.theme.background}`;
  const primary = `#${project.theme.primary}`;
  const secondary = `#${project.theme.secondary}`;
  const muted = `#${project.theme.muted}`;
  const density = slide.bullets.length > 5 ? "dense" : slide.bullets.length > 3 ? "compact" : "normal";
  const titleSize = density === "dense" ? 58 : density === "compact" ? 66 : 74;
  const bulletSize = density === "dense" ? 27 : 31;

  if (visual) {
    return (
      <div className="relative h-[720px] w-[1280px] bg-slate-100">
        <Image
          src={visual}
          alt={slide.title}
          fill
          priority
          unoptimized
          sizes="1280px"
          className="object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="relative h-[720px] w-[1280px] overflow-hidden"
      style={{ background, color: foreground, fontFamily: project.theme.font }}
    >
      <div className="absolute inset-0 opacity-90">
        <div className="absolute left-0 top-0 h-full w-[18px]" style={{ background: primary }} />
        <div
          className="absolute right-[80px] top-[70px] h-[170px] w-[170px] rounded-full"
          style={{ background: secondary, opacity: 0.22 }}
        />
        <div className="absolute bottom-[70px] right-[90px] h-[2px] w-[300px]" style={{ background: primary }} />
      </div>
      <div className={cn("relative flex h-full flex-col", compact ? "p-[70px]" : "px-[96px] py-[78px]")}>
        <div className="flex items-center gap-[18px] text-[24px] font-semibold uppercase tracking-normal" style={{ color: muted }}>
          <span>{formatSlideNumber(slide.order)}</span>
          <span className="h-[2px] w-[72px]" style={{ background: primary }} />
          <span>{slide.accent || slide.layout}</span>
        </div>
        <h1
          className="mt-[34px] max-w-[980px] break-words font-bold tracking-normal"
          style={{ fontSize: titleSize, lineHeight: 1.05 }}
        >
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p className="mt-[22px] max-w-[860px] break-words text-[34px] leading-tight" style={{ color: muted }}>
            {slide.subtitle}
          </p>
        )}
        {slide.bullets.length > 0 && (
          <div
            className={cn(
              "mt-[48px] grid min-h-0 flex-1 content-start gap-[22px]",
              slide.layout === "COMPARISON" || slide.bullets.length > 4 ? "grid-cols-2" : "grid-cols-1"
            )}
          >
            {slide.bullets.map((item, bulletIndex) => (
              <div
                key={`${item}-${bulletIndex}`}
                className="flex min-w-0 items-start gap-[18px] rounded-[8px] border bg-white/70 px-[24px] py-[20px]"
                style={{ borderColor: `${project.theme.primary}26` }}
              >
                <span
                  className="mt-[5px] flex size-[30px] shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white"
                  style={{ background: primary }}
                >
                  {bulletIndex + 1}
                </span>
                <span className="min-w-0 break-words font-medium" style={{ fontSize: bulletSize, lineHeight: 1.28 }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
