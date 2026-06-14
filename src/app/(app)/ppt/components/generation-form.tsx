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
import { Loader2, FileText, LinkIcon, ListChecks, Presentation, Upload } from "lucide-react";
import { toast } from "sonner";
import { PPT_STYLE_PRESETS, type PptStyleMaterialOption } from "@/lib/ppt-agent/styles";
import { CancelProjectButton } from "./cancel-project-button";

type SourceType = "topic" | "markdown" | "url" | "document";

interface StreamEvent {
  event: string;
  data: unknown;
}

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

interface GenerationFormProps {
  useOwnKey: boolean;
  creditsPerSlide: number;
  styleMaterials: PptStyleMaterialOption[];
  initialStyleMaterialId?: string;
}

type StyleSource = "preset" | "material" | "custom";

export function GenerationForm({
  useOwnKey,
  creditsPerSlide,
  styleMaterials,
  initialStyleMaterialId,
}: GenerationFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>("topic");
  const [topic, setTopic] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFilePath, setSourceFilePath] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [slideCount, setSlideCount] = useState(10);
  const [aspectRatio, setAspectRatio] = useState("16:9");
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
    const normalizedTopic = topic.trim();
    const normalizedMarkdown = markdown.trim();

    if (sourceType === "topic" && !normalizedTopic) {
      toast.error("请输入 PPT 主题。");
      return;
    }
    if (sourceType === "markdown" && !normalizedMarkdown) {
      toast.error("请粘贴 Markdown 或结构化内容。");
      return;
    }
    if (sourceType === "url" && !sourceUrl.trim()) {
      toast.error("请输入网页 URL。");
      return;
    }
    if (sourceType === "document" && !sourceFilePath) {
      toast.error("请先上传文档。");
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
          sourceType,
          sourceTopic: sourceType === "topic" ? normalizedTopic : undefined,
          sourceMarkdown: sourceType === "markdown" ? normalizedMarkdown : undefined,
          sourceUrl: sourceType === "url" ? sourceUrl.trim() : undefined,
          sourceFileUrl: sourceType === "document" ? sourceFilePath : undefined,
          slideCount,
          aspectRatio,
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

  async function handleFileChange(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ppt/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "文档上传失败");
      setSourceFilePath(data.path);
      setSourceFileName(data.name || file.name);
      toast.success("文档已上传。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文档上传失败");
      setSourceFilePath("");
      setSourceFileName("");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">创建 PPT 项目</h2>
        <p className="text-sm text-muted-foreground">支持主题、Markdown、网页和文档输入，生成过程会按 PPT Master 流程执行。</p>
      </div>

      <Tabs value={sourceType} onValueChange={(value) => setSourceType(value as SourceType)}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="topic">
            <FileText className="size-4" />
            输入主题
          </TabsTrigger>
          <TabsTrigger value="markdown">
            <ListChecks className="size-4" />
            粘贴内容
          </TabsTrigger>
          <TabsTrigger value="url">
            <LinkIcon className="size-4" />
            网页
          </TabsTrigger>
          <TabsTrigger value="document">
            <Upload className="size-4" />
            文档
          </TabsTrigger>
        </TabsList>

        <TabsContent value="topic" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic">PPT 主题</Label>
            <Textarea
              id="topic"
              placeholder="例如：AI Agent 在企业知识管理中的落地路径"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={4}
            />
          </div>
        </TabsContent>

        <TabsContent value="markdown" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="markdown">Markdown / 结构化内容</Label>
            <Textarea
              id="markdown"
              placeholder="粘贴文章、提纲、会议纪要或 Markdown 内容"
              value={markdown}
              onChange={(event) => setMarkdown(event.target.value)}
              rows={9}
            />
          </div>
        </TabsContent>

        <TabsContent value="url" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sourceUrl">网页 URL</Label>
            <Input
              id="sourceUrl"
              type="url"
              placeholder="https://example.com/article"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
            />
          </div>
        </TabsContent>

        <TabsContent value="document" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sourceFile">上传文档</Label>
            <Input
              id="sourceFile"
              type="file"
              accept=".pdf,.docx,.html,.htm,.epub,.ipynb,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.xlsx,.xlsm"
              disabled={uploading}
              onChange={(event) => handleFileChange(event.target.files?.[0])}
            />
            <p className="text-sm text-muted-foreground">
              {uploading ? "正在上传文档..." : sourceFileName ? `已上传：${sourceFileName}` : "支持 PDF、DOCX、PPTX、XLSX、HTML、EPUB 等格式。"}
            </p>
          </div>
        </TabsContent>
      </Tabs>

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
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Presentation className="size-4" />}
        {loading
          ? "正在生成"
          : useOwnKey
            ? "开始生成 · 使用我的 API"
            : `开始生成 · 预估 ${estimatedCost} 积分`}
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
