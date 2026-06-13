"use client";

import { memo } from "react";
import { FileText, Loader2, Plus, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  GORDEN_PPT_TEMPLATES,
  PPT_GENERATION_MODES,
  PPT_STYLES,
  PPT_TONES,
  type GordenPptTemplate,
  type PptGenerationMode,
  type PptOutlineSlide,
} from "@/lib/ppt-shared";
import { OutlineEditor } from "./outline-editor";

const SLIDE_COUNTS = [5, 8, 10, 12, 15, 20];

interface Props {
  topic: string;
  audience: string;
  sourceText: string;
  generationMode: PptGenerationMode;
  template: GordenPptTemplate;
  style: string;
  tone: string;
  slideCount: string;
  model: string;
  models: string[];
  outlineTitle: string;
  outlineSlides: PptOutlineSlide[];
  pending: boolean;
  hasModels: boolean;
  useOwnKey: boolean;
  unitCost: number;
  onTopicChange: (value: string) => void;
  onAudienceChange: (value: string) => void;
  onSourceTextChange: (value: string) => void;
  onGenerationModeChange: (value: PptGenerationMode) => void;
  onTemplateChange: (value: GordenPptTemplate) => void;
  onStyleChange: (value: string) => void;
  onToneChange: (value: string) => void;
  onSlideCountChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onOutlineTitleChange: (value: string) => void;
  onUpdateOutlineSlide: (index: number, patch: Partial<PptOutlineSlide>) => void;
  onUpdateOutlineBullets: (index: number, value: string) => void;
  onMoveOutlineSlide: (index: number, direction: -1 | 1) => void;
  onRemoveOutlineSlide: (index: number) => void;
  onAddOutlineSlide: () => void;
  onGenerateOutline: () => void;
  onGenerateFromOutline: () => void;
  onGenerateDirectly: () => void;
}

export const GenerationForm = memo(function GenerationForm({
  topic,
  audience,
  sourceText,
  generationMode,
  template,
  style,
  tone,
  slideCount,
  model,
  models,
  outlineTitle,
  outlineSlides,
  pending,
  hasModels,
  useOwnKey,
  unitCost,
  onTopicChange,
  onAudienceChange,
  onSourceTextChange,
  onGenerationModeChange,
  onTemplateChange,
  onStyleChange,
  onToneChange,
  onSlideCountChange,
  onModelChange,
  onOutlineTitleChange,
  onUpdateOutlineSlide,
  onUpdateOutlineBullets,
  onMoveOutlineSlide,
  onRemoveOutlineSlide,
  onAddOutlineSlide,
  onGenerateOutline,
  onGenerateFromOutline,
  onGenerateDirectly,
}: Props) {
  const hasOutline = outlineSlides.length > 0;
  const activeTemplate = GORDEN_PPT_TEMPLATES.find((item) => item.value === template);

  return (
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
            onChange={(event) => onTopicChange(event.target.value)}
            maxLength={500}
          />
        </div>
        <div className="space-y-2">
          <Label>目标观众</Label>
          <Input
            placeholder="例如：投资人、老板、客户、学生"
            value={audience}
            onChange={(event) => onAudienceChange(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>页数</Label>
            <Select value={slideCount} onValueChange={onSlideCountChange}>
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
            <Select value={style} onValueChange={onStyleChange}>
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
        <div className="space-y-3">
          <Label>生成方式</Label>
          <Tabs value={generationMode} onValueChange={(value) => onGenerationModeChange(value as PptGenerationMode)}>
            <TabsList className="grid w-full grid-cols-2">
              {PPT_GENERATION_MODES.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {PPT_GENERATION_MODES.find((item) => item.value === generationMode)?.description}
          </p>
        </div>
        {generationMode === "TEMPLATE" && (
          <div className="space-y-2">
            <Label>Gorden 模板</Label>
            <Select value={template} onValueChange={(value) => onTemplateChange(value as GordenPptTemplate)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GORDEN_PPT_TEMPLATES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTemplate && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                <div className="font-medium text-foreground">
                  {activeTemplate.pages} 页 · {activeTemplate.color}
                </div>
                <div>{activeTemplate.description}</div>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label>表达方式</Label>
          <Select value={tone} onValueChange={onToneChange}>
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
            <Select value={model} onValueChange={onModelChange}>
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
            onChange={(event) => onSourceTextChange(event.target.value)}
            maxLength={8000}
          />
        </div>
        {hasOutline && (
          <OutlineEditor
            title={outlineTitle}
            slides={outlineSlides}
            onTitleChange={onOutlineTitleChange}
            onUpdateSlide={onUpdateOutlineSlide}
            onUpdateBullets={onUpdateOutlineBullets}
            onMoveSlide={onMoveOutlineSlide}
            onRemoveSlide={onRemoveOutlineSlide}
            onAddSlide={onAddOutlineSlide}
          />
        )}
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {!hasModels
            ? "PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型。"
            : useOwnKey
              ? "使用你的 API，不扣平台积分。"
              : `平台模型生成每份消耗 ${unitCost} 积分。`}
        </div>
        <Button className="w-full" onClick={onGenerateOutline} disabled={pending || !hasModels}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          {hasOutline ? "刷新大纲" : "生成大纲"}
        </Button>
        {hasOutline && (
          <Button className="w-full" onClick={onGenerateFromOutline} disabled={pending || !hasModels}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Presentation className="size-4" />}
            确认大纲并生成 PPT
          </Button>
        )}
        <Button className="w-full" variant="outline" onClick={onGenerateDirectly} disabled={pending || !hasModels}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          跳过大纲直接生成
        </Button>
      </CardContent>
    </Card>
  );
});
