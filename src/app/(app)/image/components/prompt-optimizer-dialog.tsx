"use client";

import { useMemo, useState } from "react";
import { Check, FileText, Loader2, Save, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_QUALITY_META } from "@/lib/image-quality";
import { cn } from "@/lib/utils";
import type { PromptOptimizationResult, PromptOptimizeMode, PromptOptimizeRequest } from "../types";

const OPTIMIZE_MODES: Array<{
  value: PromptOptimizeMode;
  label: string;
  description: string;
  instruction: string;
}> = [
  {
    value: "balanced",
    label: "均衡",
    description: "保留原意并补充画面要素",
    instruction: "保留我的原意，补充主体、构图、光线、材质、背景和质量描述。",
  },
  {
    value: "detail",
    label: "细节",
    description: "加强材质、光影和层次",
    instruction: "加强画面细节、材质纹理、光影层次和环境氛围，但不要偏离原主题。",
  },
  {
    value: "realistic",
    label: "真实",
    description: "偏摄影和真实质感",
    instruction: "改成真实摄影风格，强调自然光、真实材质、镜头感和可信场景。",
  },
  {
    value: "illustration",
    label: "插画",
    description: "偏角色、色彩和画风",
    instruction: "改成精致插画风格，强调画风、色彩、角色表情和完整构图。",
  },
  {
    value: "product",
    label: "商品",
    description: "偏商业展示和干净背景",
    instruction: "改成商业商品展示图，主体突出，背景干净，材质清晰，有可售卖质感。",
  },
  {
    value: "concise",
    label: "精简",
    description: "压缩成稳定直接的表达",
    instruction: "压缩成更稳定、更直接的生图提示词，去掉重复和冲突表达。",
  },
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  open: boolean;
  prompt: string;
  mode: "generate" | "edit";
  ratio: string;
  quality: string;
  count: number;
  model: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onOptimize: (request: PromptOptimizeRequest) => Promise<PromptOptimizationResult>;
  onApplyPrompt: (prompt: string) => void;
  onApplySettings: (settings: { ratio?: string; quality?: string; count?: number }) => void;
}

function qualityLabel(value?: string) {
  if (!value) return "";
  return IMAGE_QUALITY_META[value as keyof typeof IMAGE_QUALITY_META]?.label || value;
}

function fallbackInstruction(mode: PromptOptimizeMode) {
  return OPTIMIZE_MODES.find((item) => item.value === mode)?.instruction || "";
}

export function PromptOptimizerDialog({
  open,
  prompt,
  mode,
  ratio,
  quality,
  count,
  model,
  submitting,
  onOpenChange,
  onOptimize,
  onApplyPrompt,
  onApplySettings,
}: Props) {
  const [optimizeMode, setOptimizeMode] = useState<PromptOptimizeMode>("balanced");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<PromptOptimizationResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const trimmedPrompt = prompt.trim();
  const currentPrompt = result?.prompt.trim() || "";
  const canRun = !!trimmedPrompt && !submitting && !loading && !!instruction.trim();
  const actionLabel = result ? "继续修改" : "开始优化";

  const suggestionSummary = useMemo(() => {
    if (!result) return "";
    return [
      result.suggestedRatio,
      qualityLabel(result.suggestedQuality),
      result.suggestedCount ? `${result.suggestedCount}张` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }, [result]);

  function resetState() {
    setOptimizeMode("balanced");
    setInstruction("");
    setResult(null);
    setMessages([]);
    setLoading(false);
    setSaving(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetState();
    onOpenChange(next);
  }

  function selectMode(nextMode: PromptOptimizeMode) {
    setOptimizeMode(nextMode);
    setInstruction(fallbackInstruction(nextMode));
  }

  async function runOptimize() {
    const text = instruction.trim();
    if (!trimmedPrompt) {
      toast.error("请先输入提示词");
      return;
    }
    if (!text) {
      toast.error("请选择优化方式或输入你的修改想法");
      return;
    }

    const nextUserMessage: ChatMessage = { role: "user", content: text };
    setLoading(true);
    try {
      const data = await onOptimize({
        optimizeMode,
        instruction: text,
        currentPrompt: currentPrompt || undefined,
        messages: [...messages, nextUserMessage],
      });
      setResult(data);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.reply || data.explanation || "已根据你的要求更新提示词。",
      };
      setMessages((prev) => [...prev, nextUserMessage, assistantMessage]);
      setInstruction("");
      if (data.fallback) toast.info("当前未配置可用文本模型，已使用本地优化方案");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提示词优化失败");
    } finally {
      setLoading(false);
    }
  }

  async function savePrompt() {
    if (!result?.prompt.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/materials/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: result.prompt.slice(0, 24) || "AI 优化提示词",
          description: result.explanation || result.reply || "来自 AI 提示词助手",
          promptText: result.prompt,
          tags: "AI优化,图片生成",
          visibility: "PRIVATE",
          meta: {
            mode,
            ratio: result.suggestedRatio || ratio,
            quality: result.suggestedQuality || quality,
            count: result.suggestedCount || count,
            model: model || undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success("已保存到我的提示词素材");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function applyPrompt() {
    if (!result?.prompt.trim()) return;
    onApplyPrompt(result.prompt.trim().slice(0, 4000));
    toast.success("已应用优化提示词");
  }

  function applyAll() {
    applyPrompt();
    onApplySettings({
      ratio: result?.suggestedRatio,
      quality: result?.suggestedQuality,
      count: result?.suggestedCount,
    });
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            AI 提示词助手
          </DialogTitle>
          <DialogDescription>
            先选择优化方向或输入想法，再开始打磨；后续可以继续对当前稿提出修改。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>优化方式</Label>
              <div className="grid gap-2">
                {OPTIMIZE_MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    disabled={loading}
                    onClick={() => selectMode(item.value)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-accent",
                      optimizeMode === item.value && "border-primary bg-primary/5"
                    )}
                  >
                    <span className="font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>原提示词</Label>
              <div className="max-h-32 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                {trimmedPrompt}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            {messages.length > 0 && (
              <div className="space-y-2">
                <Label>修改过程</Label>
                <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm",
                        message.role === "user"
                          ? "ml-8 bg-primary text-primary-foreground"
                          : "mr-8 border bg-background text-muted-foreground"
                      )}
                    >
                      {message.content}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>当前优化稿</Label>
                {suggestionSummary && (
                  <span className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">
                    {suggestionSummary}
                  </span>
                )}
              </div>
              <Textarea
                readOnly
                rows={8}
                value={loading && !result ? "正在生成优化方案..." : result?.prompt || ""}
                placeholder="选择优化方式或输入你的想法后，点击开始优化"
                className="max-h-72 resize-none bg-muted/20"
              />
            </div>

            {result?.negativePrompt && (
              <div className="space-y-1">
                <Label>建议规避</Label>
                <div className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                  {result.negativePrompt}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>{result ? "继续说你的修改想法" : "你想怎么优化"}</Label>
              <Textarea
                rows={3}
                value={instruction}
                disabled={loading}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={
                  result
                    ? "例如：更梦幻一点，背景简单些，不要太复杂"
                    : "选择左侧模式会自动填入要求，也可以直接写你的想法"
                }
                className="resize-none"
              />
              <div className="flex justify-end">
                <Button type="button" disabled={!canRun} onClick={() => void runOptimize()}>
                  {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {loading ? "处理中..." : actionLabel}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t px-5 py-4">
          <Button type="button" variant="outline" disabled={!result?.prompt || saving} onClick={savePrompt}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存到素材库
          </Button>
          <Button type="button" variant="outline" disabled={!result?.prompt} onClick={applyPrompt}>
            <FileText className="size-4" />
            只应用提示词
          </Button>
          <Button type="button" disabled={!result?.prompt} onClick={applyAll}>
            <Check className="size-4" />
            应用提示词和参数
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
