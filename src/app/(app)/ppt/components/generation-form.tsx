"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LinkIcon, Loader2, Paperclip, Plus, Presentation, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PPT_STYLE_PRESETS, type PptStyleMaterialOption } from "@/lib/ppt-agent/styles";
import { CancelProjectButton } from "./cancel-project-button";
import type { PptTemplateOption } from "@/lib/ppt-agent/templates";

interface StreamEvent {
  event: string;
  data: unknown;
}

interface GenerationFormProps {
  useOwnKey: boolean;
  creditsPerSlide: number;
  styleMaterials: PptStyleMaterialOption[];
  initialStyleMaterialId?: string;
  templateOptions: PptTemplateOption[];
}

interface UploadedFile {
  path: string;
  name: string;
  size: number;
}

type StyleSource = "preset" | "material" | "custom";

function parseSseChunk(chunk: string): StreamEvent[] {
  return chunk
    .split("\n\n")
    .map((block) => {
      const lines = block.split("\n");
      const event = lines
        .find((line) => line.startsWith("event:"))
        ?.replace("event:", "")
        .trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace("data:", "").trim())
        .join("\n");
      if (!event || !data) return null;
      try {
        return { event, data: JSON.parse(data) };
      } catch {
        return null;
      }
    })
    .filter((item): item is StreamEvent => Boolean(item));
}

export function GenerationForm({
  useOwnKey,
  creditsPerSlide,
  styleMaterials,
  initialStyleMaterialId,
  templateOptions,
}: GenerationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [sourceUrls, setSourceUrls] = useState<string[]>([]);
  const [sourceFiles, setSourceFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [slideCount, setSlideCount] = useState(10);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [template, setTemplate] = useState("none");
  const [style, setStyle] = useState("general");
  const initialMaterialExists = Boolean(
    initialStyleMaterialId && styleMaterials.some((item) => item.id === initialStyleMaterialId)
  );
  const [styleSource, setStyleSource] = useState<StyleSource>(initialMaterialExists ? "material" : "preset");
  const [styleMaterialId, setStyleMaterialId] = useState(
    initialMaterialExists ? initialStyleMaterialId! : styleMaterials[0]?.id || ""
  );
  const [customStyle, setCustomStyle] = useState("");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");

  const estimatedCost = useMemo(
    () => (useOwnKey ? 0 : slideCount * creditsPerSlide),
    [creditsPerSlide, slideCount, useOwnKey]
  );

  async function handleSubmit() {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt && sourceUrls.length === 0 && sourceFiles.length === 0) {
      toast.error("请描述你想生成的 PPT，或添加网页/文件资料。");
      return;
    }
    if (styleSource === "material" && !styleMaterialId) {
      toast.error("请选择一个已收藏或自己创建的 PPT 风格。");
      return;
    }
    if (styleSource === "custom" && !customStyle.trim()) {
      toast.error("请填写自定义 PPT 风格描述。");
      return;
    }

    setLoading(true);
    setProgress(0);
    setLogs([]);
    setActiveProjectId("");

    let projectId = "";
    let pending = "";

    try {
      const res = await fetch("/api/ppt/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: normalizedPrompt,
          sourceUrls,
          sourceFileUrls: sourceFiles.map((file) => file.path),
          slideCount,
          aspectRatio,
          template: template === "none" ? undefined : template,
          style: styleSource === "preset" ? style : styleSource,
          styleMaterialId: styleSource === "material" ? styleMaterialId : undefined,
          customStyle: styleSource === "custom" ? customStyle.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "生成失败");
      }
      if (!res.body) throw new Error("生成接口没有返回进度流。");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });

        const boundary = pending.lastIndexOf("\n\n");
        const ready = boundary >= 0 ? pending.slice(0, boundary + 2) : "";
        pending = boundary >= 0 ? pending.slice(boundary + 2) : pending;

        for (const item of parseSseChunk(ready)) {
          const data = item.data as { projectId?: string; message?: string; progress?: number };
          if (item.event === "project" && data.projectId) {
            projectId = data.projectId;
            setActiveProjectId(data.projectId);
          }
          if ((item.event === "phase" || item.event === "progress") && typeof data.progress === "number") {
            setProgress(data.progress);
          }
          if (item.event === "log" && data.message) {
            setLogs((prev) => [...prev.slice(-5), data.message!]);
          }
          if (item.event === "complete") {
            toast.success("PPT 生成完成。");
            router.push(`/ppt/${projectId || data.projectId}`);
            router.refresh();
            return;
          }
          if (item.event === "error") {
            throw new Error(data.message || "生成失败");
          }
          if (item.event === "cancelled") {
            toast.info(data.message || "已停止生成");
            if (projectId) router.refresh();
            return;
          }
        }

        if (done) break;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成失败");
      if (projectId) router.refresh();
    } finally {
      setLoading(false);
      setActiveProjectId("");
    }
  }

  function addUrl() {
    const value = urlInput.trim();
    if (!value) return;
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      if (sourceUrls.includes(url.toString())) {
        setUrlInput("");
        return;
      }
      setSourceUrls((prev) => [...prev, url.toString()]);
      setUrlInput("");
    } catch {
      toast.error("请输入有效的网页链接。");
    }
  }

  async function handleFileChange(files?: FileList | null) {
    const list = Array.from(files || []);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of list) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/ppt/upload", { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `${file.name} 上传失败`);
        uploaded.push({ path: data.path, name: data.name || file.name, size: data.size || file.size });
      }
      setSourceFiles((prev) => [...prev, ...uploaded]);
      toast.success(uploaded.length === 1 ? "文件已上传。" : `已上传 ${uploaded.length} 个文件。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文件上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">你想生成什么 PPT？</h2>
        <p className="text-sm text-muted-foreground">
          直接描述需求，也可以同时上传文件、添加网页链接，系统会合并理解后按 PPT Master 流程生成。
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="pptPrompt">PPT 需求</Label>
        <Textarea
          id="pptPrompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={9}
          maxLength={80000}
          placeholder="例如：帮我做一份 12 页中文融资路演 PPT，面向投资人，重点突出市场规模、产品壁垒和商业模式。可以参考我上传的文档和下面的网页链接。"
          className="min-h-52"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-2">
          <Label htmlFor="sourceUrl">网页链接</Label>
          <div className="flex gap-2">
            <Input
              id="sourceUrl"
              type="url"
              placeholder="https://example.com/article"
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addUrl();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={addUrl}>
              <Plus className="size-4" />
              添加
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sourceFiles">参考文件</Label>
          <Input
            id="sourceFiles"
            type="file"
            multiple
            accept=".pdf,.docx,.html,.htm,.epub,.ipynb,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.xlsx,.xlsm"
            disabled={uploading}
            onChange={(event) => handleFileChange(event.target.files)}
          />
        </div>
      </div>

      {(sourceUrls.length > 0 || sourceFiles.length > 0) && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          {sourceUrls.map((url) => (
            <AttachmentRow
              key={url}
              icon={<LinkIcon className="size-4" />}
              label={url}
              onRemove={() => setSourceUrls((prev) => prev.filter((item) => item !== url))}
            />
          ))}
          {sourceFiles.map((file) => (
            <AttachmentRow
              key={file.path}
              icon={<Paperclip className="size-4" />}
              label={`${file.name} · ${formatBytes(file.size)}`}
              onRemove={() => setSourceFiles((prev) => prev.filter((item) => item.path !== file.path))}
            />
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="slideCount">目标页数</Label>
          <Input
            id="slideCount"
            type="number"
            min={3}
            max={30}
            value={slideCount}
            onChange={(event) => setSlideCount(Number(event.target.value) || 10)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="aspectRatio">画布比例</Label>
          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger id="aspectRatio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16:9">16:9 宽屏</SelectItem>
              <SelectItem value="4:3">4:3 标准</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <Label htmlFor="template">PPT Master 模板</Label>
        <Select value={template} onValueChange={setTemplate}>
          <SelectTrigger id="template">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">自由设计</SelectItem>
            {templateOptions.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          {template === "none"
            ? "不套用固定模板，由 agent 按内容自由设计。"
            : templateOptions.find((item) => item.value === template)?.summary || "使用选定模板的品牌、版式或整套视觉规范。"}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>生成风格</Label>
          <Link href="/materials?type=PPT_STYLE" className="text-sm text-primary hover:underline">
            去素材广场收藏风格
          </Link>
        </div>
        <Tabs value={styleSource} onValueChange={(value) => setStyleSource(value as StyleSource)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="preset">内置风格</TabsTrigger>
            <TabsTrigger value="material">素材风格</TabsTrigger>
            <TabsTrigger value="custom">自定义</TabsTrigger>
          </TabsList>

          <TabsContent value="preset" className="space-y-2">
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger id="style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPT_STYLE_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {PPT_STYLE_PRESETS.find((preset) => preset.id === style)?.description}
            </p>
          </TabsContent>

          <TabsContent value="material" className="space-y-2">
            {styleMaterials.length > 0 ? (
              <>
                <Select value={styleMaterialId} onValueChange={setStyleMaterialId}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择素材风格" />
                  </SelectTrigger>
                  <SelectContent>
                    {styleMaterials.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.title} · {item.source === "mine" ? "我的" : item.source === "favorite" ? "收藏" : "公开"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {styleMaterials.find((item) => item.id === styleMaterialId)?.description ||
                    styleMaterials.find((item) => item.id === styleMaterialId)?.promptText}
                </p>
              </>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                还没有可用的 PPT 风格素材。可以在我的素材库新建“PPT 风格”，或到素材广场收藏公开风格。
              </div>
            )}
          </TabsContent>

          <TabsContent value="custom" className="space-y-2">
            <Textarea
              value={customStyle}
              onChange={(event) => setCustomStyle(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="描述你想要的 PPT 风格，例如：深色科技风，强调系统架构、流程图和关键指标，整体像 AI 产品发布会。"
            />
          </TabsContent>
        </Tabs>
      </div>

      {loading && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">生成进度</span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          {logs.length > 0 && (
            <div className="space-y-1 pt-1 text-xs text-muted-foreground">
              {logs.map((item, index) => (
                <p key={`${item}-${index}`}>{item}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <Button onClick={handleSubmit} disabled={loading || uploading} className="w-full">
        {loading || uploading ? <Loader2 className="size-4 animate-spin" /> : <Presentation className="size-4" />}
        {uploading
          ? "正在上传文件"
          : loading
            ? "正在生成"
            : useOwnKey
              ? "开始生成 · 使用我的 API"
              : `开始生成 · 预计 ${estimatedCost} 积分`}
      </Button>
      {loading && activeProjectId && (
        <CancelProjectButton
          projectId={activeProjectId}
          size="default"
          variant="destructive"
          onCancelled={() => {
            setLoading(false);
            setActiveProjectId("");
          }}
        />
      )}
    </div>
  );
}

function AttachmentRow({ icon, label, onRemove }: { icon: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-background px-3 py-2 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Button type="button" variant="outline" size="icon" onClick={onRemove} aria-label="移除附件">
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
