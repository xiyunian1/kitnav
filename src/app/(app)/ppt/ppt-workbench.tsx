"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PPT_STYLES, PPT_TONES, type PptSlideContent, type SerializedPptProject } from "@/lib/ppt-shared";
import { cn } from "@/lib/utils";
import {
  generatePptProjectAction,
  regeneratePptSlideVisualAction,
  rewritePptSlideAction,
  updatePptSlideAction,
} from "./actions";

interface Props {
  initialProjects: SerializedPptProject[];
  unitCost: number;
  useOwnKey: boolean;
  models: string[];
  defaultModel: string;
}

const SLIDE_COUNTS = [5, 8, 10, 12, 15, 20];
const PREVIEW_WIDTH = 960;
const PREVIEW_HEIGHT = 540;
type EditableSlide = PptSlideContent & { id: string };

function hasSlideId(slide: PptSlideContent): slide is EditableSlide {
  return typeof slide.id === "string" && slide.id.length > 0;
}

export function PptWorkbench({
  initialProjects,
  unitCost,
  useOwnKey,
  models,
  defaultModel,
}: Props) {
  const [projects, setProjects] = useState(initialProjects);
  const [activeId, setActiveId] = useState(initialProjects[0]?.id ?? "");
  const active = useMemo(
    () => projects.find((project) => project.id === activeId) ?? projects[0] ?? null,
    [activeId, projects]
  );
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [style, setStyle] = useState("BUSINESS");
  const [tone, setTone] = useState("PROFESSIONAL");
  const [slideCount, setSlideCount] = useState("8");
  const [model, setModel] = useState(defaultModel);
  const [selectedSlideId, setSelectedSlideId] = useState(active?.slides[0]?.id ?? "");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Record<string, PptSlideContent>>({});
  const hasModels = models.length > 0 && Boolean(defaultModel);

  const selectedSlide =
    active?.slides.find((slide) => slide.id === selectedSlideId && hasSlideId(slide)) ??
    active?.slides.find(hasSlideId) ??
    null;
  const selectedSlideWithId = selectedSlide && hasSlideId(selectedSlide) ? selectedSlide : null;
  const draft = selectedSlideWithId ? editing[selectedSlideWithId.id] ?? selectedSlideWithId : null;

  function replaceProject(project: SerializedPptProject) {
    setProjects((prev) => {
      const exists = prev.some((item) => item.id === project.id);
      return exists
        ? prev.map((item) => (item.id === project.id ? project : item))
        : [project, ...prev];
    });
    setActiveId(project.id);
    setSelectedSlideId(project.slides.find(hasSlideId)?.id ?? "");
  }

  function handleGenerate() {
    if (!topic.trim()) {
      toast.error("请输入 PPT 主题");
      return;
    }
    if (!hasModels) {
      toast.error("PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型");
      return;
    }
    startTransition(async () => {
      try {
        const project = await generatePptProjectAction({
          topic,
          audience,
          sourceText,
          style: style as never,
          tone: tone as never,
          slideCount: Number(slideCount),
          model: model || undefined,
        });
        replaceProject(project);
        toast.success("PPT 已生成");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "PPT 生成失败");
      }
    });
  }

  function setDraft<K extends keyof PptSlideContent>(key: K, value: PptSlideContent[K]) {
    if (!selectedSlideWithId) return;
    setEditing((prev) => ({
      ...prev,
      [selectedSlideWithId.id]: {
        ...(prev[selectedSlideWithId.id] ?? selectedSlideWithId),
        [key]: value,
      },
    }));
  }

  function handleSaveSlide() {
    if (!selectedSlideWithId || !draft) return;
    startTransition(async () => {
      try {
        const project = await updatePptSlideAction(selectedSlideWithId.id, {
          title: draft.title,
          subtitle: draft.subtitle,
          layout: draft.layout,
          bullets: draft.bullets,
          speakerNotes: draft.speakerNotes,
          visualPrompt: draft.visualPrompt,
          accent: draft.accent,
        });
        if (project) replaceProject(project);
        setEditing((prev) => {
          const next = { ...prev };
          delete next[selectedSlideWithId.id];
          return next;
        });
        toast.success("已保存本页");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败");
      }
    });
  }

  function handleRewriteSlide() {
    if (!selectedSlideWithId || !rewriteInstruction.trim()) {
      toast.error("请输入修改要求");
      return;
    }
    startTransition(async () => {
      try {
        const project = await rewritePptSlideAction(selectedSlideWithId.id, rewriteInstruction, model || undefined);
        if (project) replaceProject(project);
        setRewriteInstruction("");
        toast.success("本页已改写");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "改写失败");
      }
    });
  }

  function handleRegenerateVisual() {
    if (!selectedSlideWithId) return;
    startTransition(async () => {
      try {
        const project = await regeneratePptSlideVisualAction(selectedSlideWithId.id);
        if (project) replaceProject(project);
        toast.success("本页视觉已重绘");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重绘失败");
      }
    });
  }

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Presentation className="size-4" />
            PPT 创作
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>主题</Label>
            <Textarea
              className="min-h-20 resize-none"
              placeholder="例如：AI 绘画工具商业计划书"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label>目标观众</Label>
            <Input
              placeholder="例如：投资人、老板、客户、学生"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>页数</Label>
              <Select value={slideCount} onValueChange={setSlideCount}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIDE_COUNTS.map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count} 页
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>风格</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PPT_STYLES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>表达方式</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPT_TONES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {models.length > 0 && (
            <div className="space-y-2">
              <Label>模型</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="默认模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>资料/要求</Label>
            <Textarea
              className="min-h-28 resize-none"
              placeholder="粘贴文档资料、产品信息、必须覆盖的要点"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              maxLength={8000}
            />
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            {!hasModels
              ? "PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型。"
              : useOwnKey
                ? "使用你的 API，不扣平台积分。"
                : `平台模型生成每份消耗 ${unitCost} 积分。`}
          </div>
          <Button className="w-full" onClick={handleGenerate} disabled={pending || !hasModels}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            生成完整 PPT
          </Button>
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">{active?.title || "还没有 PPT"}</CardTitle>
          {active && (
            <Button size="sm" variant="outline" asChild>
              <a href={`/api/ppt/projects/${active.id}/export`}>
                <Download className="size-4" />
                导出
              </a>
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid min-h-0 gap-4 lg:grid-cols-[170px_minmax(0,1fr)]">
          <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
            {active?.slides.map((slide) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => hasSlideId(slide) && setSelectedSlideId(slide.id)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left text-sm transition",
                  selectedSlide?.id === slide.id
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40 hover:bg-muted/40"
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <Badge variant="outline">{slide.order}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {slide.imageStatus === "SUCCESS" ? "视觉" : "文字版"} · {slide.layout}
                  </span>
                </div>
                <div className="line-clamp-2 font-medium">{slide.title}</div>
              </button>
            ))}
            {!active && (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                从左侧输入主题生成第一份 PPT。
              </div>
            )}
          </div>

          <div className="min-w-0 overflow-y-auto">
            {draft ? (
              <SlidePreview slide={draft} project={active!} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                选择一页进行预览和编辑
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Pencil className="size-4" />
            单页编辑
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {draft ? (
            <>
              <div className="space-y-2">
                <Label>标题</Label>
                <Input value={draft.title} onChange={(event) => setDraft("title", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>副标题</Label>
                <Input value={draft.subtitle || ""} onChange={(event) => setDraft("subtitle", event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>要点</Label>
                <Textarea
                  className="min-h-32 resize-none"
                  value={draft.bullets.join("\n")}
                  onChange={(event) =>
                    setDraft(
                      "bullets",
                      event.target.value
                        .split(/\n+/)
                        .map((item) => item.trim())
                        .filter(Boolean)
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>演讲备注</Label>
                <Textarea
                  className="min-h-24 resize-none"
                  value={draft.speakerNotes || ""}
                  onChange={(event) => setDraft("speakerNotes", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>视觉描述</Label>
                <Textarea
                  className="min-h-24 resize-none"
                  placeholder="描述这一页希望呈现的背景、构图、图表、质感"
                  value={draft.visualPrompt || ""}
                  onChange={(event) => setDraft("visualPrompt", event.target.value)}
                />
              </div>
              <Button className="w-full" onClick={handleSaveSlide} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存本页
              </Button>
              <Button className="w-full" variant="secondary" onClick={handleRegenerateVisual} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
                重绘本页视觉
              </Button>
              {draft.imageStatus === "FAILED" && draft.imageError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
                  {draft.imageError}
                </div>
              )}
              <Separator />
              <div className="space-y-2">
                <Label>AI 修改要求</Label>
                <Textarea
                  className="min-h-24 resize-none"
                  placeholder="例如：把这一页改得更有说服力，并增加商业价值"
                  value={rewriteInstruction}
                  onChange={(event) => setRewriteInstruction(event.target.value)}
                />
              </div>
              <Button className="w-full" variant="outline" onClick={handleRewriteSlide} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                AI 改写本页
              </Button>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              生成或选择一页后可编辑。
            </div>
          )}
        </CardContent>
      </Card>

      {projects.length > 0 && (
        <Card className="xl:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              最近 PPT
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {projects.slice(0, 8).map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setActiveId(project.id);
                  setSelectedSlideId(project.slides.find(hasSlideId)?.id ?? "");
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition hover:border-primary/50",
                  active?.id === project.id && "border-primary bg-primary/5"
                )}
              >
                <div className="line-clamp-2 text-sm font-medium">{project.title}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {project.slideCount} 页 · {project.status}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getSlidePreviewDensity(slide: PptSlideContent) {
  const totalTextLength =
    slide.title.length +
    (slide.subtitle?.length ?? 0) +
    slide.bullets.reduce((sum, item) => sum + item.length, 0);
  if (totalTextLength > 180 || slide.bullets.length > 5) return "dense";
  if (totalTextLength > 110 || slide.bullets.length > 3) return "compact";
  return "normal";
}

function SlidePreview({ slide, project }: { slide: PptSlideContent; project: SerializedPptProject }) {
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
            unoptimized
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
                unoptimized
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
          <div className={cn("flex h-full min-h-0 flex-col", density === "dense" ? "p-[48px]" : "p-[64px]")}>
            <div
              className="h-[10px] w-[140px] shrink-0 rounded-full"
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
                style={{ gridTemplateColumns: columns }}
              >
                {slide.bullets.map((item, index) => (
                  <div
                    key={`${item}-${index}`}
                    className="min-w-0 rounded-[10px] border bg-white/70 px-[20px] py-[16px] shadow-xs"
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
}
