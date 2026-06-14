"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FileUp, ImagePlus, Loader2, MousePointer2, Music2, Play, RefreshCw, Save, SlidersHorizontal, Upload } from "lucide-react";
import { toast } from "sonner";

interface SlidePreview {
  filename: string;
  url: string;
}

interface SvgElement {
  index: number;
  tag: string;
  id: string | null;
  label: string;
  text?: string;
  attrs: Record<string, string>;
}

interface AnimationSettings {
  transition: string;
  transitionDuration: number;
  animation: string;
  animationTrigger: string;
  animationDuration: number;
  animationStagger: number;
  autoAdvance?: number | null;
}

interface AudioSettings {
  provider: string;
  voice: string;
  voiceId?: string;
  rate: string;
  locale: string;
}

const COLOR_ATTRS = ["fill", "stroke"] as const;
const NUMBER_ATTRS = ["x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "stroke-width", "font-size", "opacity"] as const;
const TEXT_ATTRS = ["id", "font-family", "font-weight", "transform"] as const;

const TRANSITION_EFFECTS = ["none", "fade", "push", "wipe", "split", "strips", "cover", "random"];
const ANIMATION_EFFECTS = [
  "none",
  "auto",
  "mixed",
  "random",
  "appear",
  "fade",
  "fly",
  "cut",
  "zoom",
  "wipe",
  "split",
  "blinds",
  "checkerboard",
  "dissolve",
  "random_bars",
  "peek",
  "wheel",
  "box",
  "circle",
  "diamond",
  "plus",
  "strips",
  "wedge",
  "stretch",
  "expand",
  "swivel",
];
const ANIMATION_TRIGGERS = ["after-previous", "with-previous", "on-click"];
const AUDIO_PROVIDERS = ["edge", "qwen", "cosyvoice", "minimax", "elevenlabs"];

const DEFAULT_ANIMATION: AnimationSettings = {
  transition: "fade",
  transitionDuration: 0.4,
  animation: "auto",
  animationTrigger: "after-previous",
  animationDuration: 0.4,
  animationStagger: 0.5,
  autoAdvance: null,
};

const DEFAULT_AUDIO: AudioSettings = {
  provider: "edge",
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "+0%",
  locale: "zh-CN",
};

export function SlideEditorWorkbench({ projectId, slides }: { projectId: string; slides: SlidePreview[] }) {
  const router = useRouter();
  const [selectedSlide, setSelectedSlide] = useState(slides[0]?.filename || "");
  const [svg, setSvg] = useState("");
  const [elements, setElements] = useState<SvgElement[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<SvgElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [reexporting, startReexport] = useTransition();
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedSlide) return;
    void loadSlide(selectedSlide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlide]);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll("[data-edit-index]").forEach((node) => {
      const el = node as HTMLElement;
      const index = Number(el.dataset.editIndex);
      el.style.cursor = "pointer";
      el.style.outline = index === selectedIndex ? "3px solid #2563eb" : "";
      el.style.outlineOffset = "2px";
    });
  }, [svg, selectedIndex]);

  async function loadSlide(slide = selectedSlide) {
    if (!slide) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/slides/${encodeURIComponent(slide)}/elements`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "读取页面失败");
      setSvg(data.svg || "");
      setElements(data.elements || []);
      const first = data.elements?.[0] as SvgElement | undefined;
      setSelectedIndex(first?.index ?? null);
      setDraft(first ? cloneElement(first) : null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取页面失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveElement() {
    if (!selectedSlide || !draft) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/slides/${encodeURIComponent(selectedSlide)}/elements`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          elements: [{
            index: draft.index,
            text: draft.text,
            attrs: draft.attrs,
          }],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "保存失败");
      setSvg(data.svg || "");
      setElements(data.elements || []);
      setSelectedIndex(draft.index);
      const next = (data.elements || []).find((item: SvgElement) => item.index === draft.index) as SvgElement | undefined;
      setDraft(next ? cloneElement(next) : null);
      toast.success(data.changed > 0 ? "元素已保存" : "没有变化");
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
        toast.success("PPTX 已重新导出");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "重新导出失败");
      }
    });
  }

  function updateDraftAttr(name: string, value: string) {
    setDraft((prev) => prev ? { ...prev, attrs: { ...prev.attrs, [name]: value } } : prev);
  }

  function pickElement(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest("[data-edit-index]") as HTMLElement | null;
    if (!target) return;
    const index = Number(target.dataset.editIndex);
    if (!Number.isInteger(index)) return;
    const next = elements.find((item) => item.index === index) || null;
    setSelectedIndex(index);
    setDraft(next ? cloneElement(next) : null);
  }

  if (slides.length === 0) return null;

  return (
    <Tabs defaultValue="edit" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <TabsList className="grid h-auto w-full grid-cols-2 lg:w-auto lg:grid-cols-5">
          <TabsTrigger value="edit">
            <MousePointer2 className="size-4" />
            页面编辑
          </TabsTrigger>
          <TabsTrigger value="animation">
            <SlidersHorizontal className="size-4" />
            动画
          </TabsTrigger>
          <TabsTrigger value="audio">
            <Music2 className="size-4" />
            旁白
          </TabsTrigger>
          <TabsTrigger value="images">
            <ImagePlus className="size-4" />
            图片
          </TabsTrigger>
          <TabsTrigger value="template">
            <FileUp className="size-4" />
            模板
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedSlide} onValueChange={setSelectedSlide}>
            <SelectTrigger className="sm:w-64">
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
          <Button type="button" variant="outline" onClick={() => loadSlide()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            刷新
          </Button>
          <Button type="button" onClick={reexport} disabled={reexporting}>
            {reexporting ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            重新导出
          </Button>
        </div>
      </div>

      <TabsContent value="edit">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden p-0">
            <div className="border-b px-4 py-2 text-sm text-muted-foreground">
              点击页面中的文字、图形或分组进行编辑
            </div>
            <div
              ref={previewRef}
              className="overflow-auto bg-muted/30 p-3 [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-full [&_svg]:rounded-md [&_svg]:border [&_svg]:bg-white"
              onClick={pickElement}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </Card>

          <Card className="p-4">
            <div className="mb-3 space-y-1">
              <h3 className="font-semibold">元素属性</h3>
              <p className="text-sm text-muted-foreground">
                {draft ? `${draft.label} · ${draft.tag}` : "请选择一个页面元素"}
              </p>
            </div>

            {draft ? (
              <div className="space-y-4">
                <Select
                  value={String(draft.index)}
                  onValueChange={(value) => {
                    const next = elements.find((item) => item.index === Number(value)) || null;
                    setSelectedIndex(Number(value));
                    setDraft(next ? cloneElement(next) : null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {elements.map((item) => (
                      <SelectItem key={item.index} value={String(item.index)}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {draft.text !== undefined && (
                  <div className="space-y-2">
                    <Label>文字</Label>
                    <Textarea
                      value={draft.text}
                      rows={Math.min(6, Math.max(2, draft.text.split("\n").length))}
                      onChange={(event) => setDraft((prev) => prev ? { ...prev, text: event.target.value } : prev)}
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {COLOR_ATTRS.map((name) => (
                    <div key={name} className="space-y-2">
                      <Label>{name}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color"
                          value={toColorValue(draft.attrs[name])}
                          onChange={(event) => updateDraftAttr(name, event.target.value)}
                          className="w-12 px-1"
                        />
                        <Input value={draft.attrs[name] || ""} onChange={(event) => updateDraftAttr(name, event.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {NUMBER_ATTRS.filter((name) => draft.attrs[name] !== undefined || ["x", "y", "width", "height", "font-size", "opacity"].includes(name)).map((name) => (
                    <div key={name} className="space-y-2">
                      <Label>{name}</Label>
                      <Input
                        value={draft.attrs[name] || ""}
                        onChange={(event) => updateDraftAttr(name, event.target.value)}
                      />
                    </div>
                  ))}
                </div>

                {TEXT_ATTRS.map((name) => (
                  <div key={name} className={cn("space-y-2", draft.tag !== "text" && name.startsWith("font") && "hidden")}>
                    <Label>{name}</Label>
                    <Input value={draft.attrs[name] || ""} onChange={(event) => updateDraftAttr(name, event.target.value)} />
                  </div>
                ))}

                <Button type="button" onClick={saveElement} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存元素
                </Button>
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                当前页面没有可编辑元素，可能是 SVG 没有可识别的文本或图形标签。
              </div>
            )}
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="animation">
        <AnimationPanel projectId={projectId} />
      </TabsContent>

      <TabsContent value="audio">
        <AudioPanel projectId={projectId} />
      </TabsContent>

      <TabsContent value="images">
        <ImagesPanel projectId={projectId} />
      </TabsContent>

      <TabsContent value="template">
        <TemplatePanel projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}

function AnimationPanel({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<AnimationSettings>(DEFAULT_ANIMATION);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/ppt/projects/${projectId}/animations`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "读取动画配置失败");
        setSettings({ ...DEFAULT_ANIMATION, ...data.settings });
        setGroups(data.groups || []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取动画配置失败");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [projectId]);

  async function save() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/animations`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "保存动画配置失败");
      setSettings({ ...DEFAULT_ANIMATION, ...data.settings });
      toast.success("动画配置已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存动画配置失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="转场" value={settings.transition} options={TRANSITION_EFFECTS} onChange={(value) => setSettings((prev) => ({ ...prev, transition: value }))} />
          <NumberField label="转场时长" value={settings.transitionDuration} onChange={(value) => setSettings((prev) => ({ ...prev, transitionDuration: value }))} />
          <SelectField label="元素动画" value={settings.animation} options={ANIMATION_EFFECTS} onChange={(value) => setSettings((prev) => ({ ...prev, animation: value }))} />
          <SelectField label="触发方式" value={settings.animationTrigger} options={ANIMATION_TRIGGERS} onChange={(value) => setSettings((prev) => ({ ...prev, animationTrigger: value }))} />
          <NumberField label="动画时长" value={settings.animationDuration} onChange={(value) => setSettings((prev) => ({ ...prev, animationDuration: value }))} />
          <NumberField label="间隔" value={settings.animationStagger} onChange={(value) => setSettings((prev) => ({ ...prev, animationStagger: value }))} />
          <NumberField label="自动翻页" value={settings.autoAdvance || 0} onChange={(value) => setSettings((prev) => ({ ...prev, autoAdvance: value > 0 ? value : null }))} />
        </div>
        <Button type="button" onClick={save} disabled={loading} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存动画配置
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">可动画分组</h3>
        <div className="max-h-80 space-y-1 overflow-auto text-sm text-muted-foreground">
          {groups.length > 0 ? groups.map((line) => <p key={line} className="font-mono">{line}</p>) : <p>未检测到顶层分组，导出时会使用默认动画策略。</p>}
        </div>
      </Card>
    </div>
  );
}

function AudioPanel({ projectId }: { projectId: string }) {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO);
  const [files, setFiles] = useState<Array<{ filename: string }>>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/ppt/projects/${projectId}/audio`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "读取旁白配置失败");
        setSettings({ ...DEFAULT_AUDIO, ...data.settings });
        setFiles(data.files || []);
        setVoices(data.voices || []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "读取旁白配置失败");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [projectId]);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "生成旁白失败");
      setSettings({ ...DEFAULT_AUDIO, ...data.settings });
      setFiles(data.files || []);
      toast.success("旁白音频已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成旁白失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="space-y-4 p-4">
        <SelectField label="服务商" value={settings.provider} options={AUDIO_PROVIDERS} onChange={(value) => setSettings((prev) => ({ ...prev, provider: value }))} />
        <div className="space-y-2">
          <Label>音色</Label>
          <Input value={settings.voice} onChange={(event) => setSettings((prev) => ({ ...prev, voice: event.target.value }))} />
        </div>
        <div className="space-y-2">
          <Label>Voice ID</Label>
          <Input value={settings.voiceId || ""} onChange={(event) => setSettings((prev) => ({ ...prev, voiceId: event.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>语速</Label>
            <Input value={settings.rate} onChange={(event) => setSettings((prev) => ({ ...prev, rate: event.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>语言</Label>
            <Input value={settings.locale} onChange={(event) => setSettings((prev) => ({ ...prev, locale: event.target.value }))} />
          </div>
        </div>
        <Button type="button" onClick={generate} disabled={loading} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          生成旁白音频
        </Button>
      </Card>

      <Card className="space-y-4 p-4">
        <div>
          <h3 className="font-semibold">已生成音频</h3>
          <div className="mt-3 space-y-3">
            {files.length > 0 ? files.map((file) => (
              <div key={file.filename} className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">{file.filename}</p>
                <audio controls src={`/api/ppt/projects/${projectId}/files/audio/${encodeURIComponent(file.filename)}`} className="w-full" />
              </div>
            )) : <p className="text-sm text-muted-foreground">还没有生成音频。</p>}
          </div>
        </div>
        {voices.length > 0 && (
          <div>
            <h3 className="mb-2 font-semibold">常用音色</h3>
            <div className="max-h-56 space-y-1 overflow-auto text-xs text-muted-foreground">
              {voices.map((line) => <p key={line} className="font-mono">{line}</p>)}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function ImagesPanel({ projectId }: { projectId: string }) {
  const [markdown, setMarkdown] = useState("");
  const [images, setImages] = useState<Array<{ filename: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/images`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "读取图片素材失败");
      setMarkdown(data.markdown || "");
      setImages(data.images || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取图片素材失败");
    } finally {
      setLoading(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/ppt/projects/${projectId}/images`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "上传图片失败");
      toast.success("图片已上传");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传图片失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="p-4">
        <h3 className="mb-3 font-semibold">图片需求清单</h3>
        {markdown ? (
          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">{markdown}</pre>
        ) : (
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            当前项目没有 image_prompts.md。生成链路未要求补图，或 agent 已直接完成图片处理。
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="ppt-image-upload">上传替换图片</Label>
          <Input id="ppt-image-upload" type="file" accept=".png,.jpg,.jpeg,.webp,.svg" disabled={loading} onChange={(event) => upload(event.target.files?.[0])} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {images.map((image) => (
            <div key={image.filename} className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/ppt/projects/${projectId}/files/images/${encodeURIComponent(image.filename)}`} alt={image.filename} className="aspect-video w-full rounded-md border object-cover" />
              <p className="truncate text-xs text-muted-foreground">{image.filename}</p>
            </div>
          ))}
        </div>
        {images.length === 0 && <p className="text-sm text-muted-foreground">项目图片目录为空。</p>}
      </Card>
    </div>
  );
}

function TemplatePanel({ projectId }: { projectId: string }) {
  const [summary, setSummary] = useState("");
  const [slides, setSlides] = useState<Array<{ filename: string; directory: string }>>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/template`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "读取模板失败");
      setSummary(data.summary || "");
      setSlides(data.slides || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取模板失败");
    } finally {
      setLoading(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/ppt/projects/${projectId}/template`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "模板导入失败");
      setSummary(data.template?.summary || "");
      setSlides(data.template?.slides || []);
      toast.success("PPTX 模板已导入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板导入失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="ppt-template-upload">上传 PPTX 模板</Label>
          <Input id="ppt-template-upload" type="file" accept=".pptx" disabled={loading} onChange={(event) => upload(event.target.files?.[0])} />
        </div>
        <Button type="button" variant="outline" onClick={load} disabled={loading} className="w-full">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          刷新模板
        </Button>
        {summary ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">{summary}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">当前项目还没有导入 PPTX 模板。</p>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-3 font-semibold">模板预览</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {slides.map((slide) => (
            <div key={`${slide.directory}/${slide.filename}`} className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/ppt/projects/${projectId}/files/${slide.directory}/${encodeURIComponent(slide.filename)}`}
                alt={slide.filename}
                className="w-full rounded-md border bg-white"
              />
              <p className="truncate text-xs text-muted-foreground">{slide.filename}</p>
            </div>
          ))}
        </div>
        {slides.length === 0 && <p className="text-sm text-muted-foreground">暂无模板 SVG 预览。</p>}
      </Card>
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="number" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </div>
  );
}

function toColorValue(value: string | undefined) {
  return /^#[0-9A-Fa-f]{6}$/.test(value || "") ? value! : "#000000";
}

function cloneElement(element: SvgElement) {
  return { ...element, attrs: { ...element.attrs } };
}
