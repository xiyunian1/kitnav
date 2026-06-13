"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type PptOutlineSlide,
  type PptGenerationMode,
  type GordenPptTemplate,
  type PptSlideContent,
  type PptStyle,
  type SerializedPptProject,
  type PptTone,
} from "@/lib/ppt-shared";
import {
  generatePptOutlineAction,
  generatePptProjectAction,
  regeneratePptSlideVisualAction,
  rewritePptSlideAction,
  updatePptSlideAction,
} from "./actions";
import { DEFAULT_TEMPLATE, hasSlideId, renumberOutlineSlides } from "./components/shared";
import { GenerationForm } from "./components/generation-form";
import { SlidePanel, RecentProjects } from "./components/slide-panel";
import { SlideEditor } from "./components/slide-editor";

interface Props {
  initialProjects: SerializedPptProject[];
  unitCost: number;
  useOwnKey: boolean;
  models: string[];
  defaultModel: string;
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
  const [generationMode, setGenerationMode] = useState<PptGenerationMode>("FREEFORM");
  const [template, setTemplate] = useState<GordenPptTemplate>(DEFAULT_TEMPLATE);
  const [style, setStyle] = useState("BUSINESS");
  const [tone, setTone] = useState("PROFESSIONAL");
  const [slideCount, setSlideCount] = useState("8");
  const [model, setModel] = useState(defaultModel);
  const [outlineTitle, setOutlineTitle] = useState("");
  const [outlineSlides, setOutlineSlides] = useState<PptOutlineSlide[]>([]);
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

  const replaceProject = useCallback((project: SerializedPptProject) => {
    setProjects((prev) => {
      const exists = prev.some((item) => item.id === project.id);
      return exists
        ? prev.map((item) => (item.id === project.id ? project : item))
        : [project, ...prev];
    });
    setActiveId(project.id);
    setSelectedSlideId(project.slides.find(hasSlideId)?.id ?? "");
  }, []);

  const generationInput = useMemo(
    () => ({
      topic,
      audience,
      sourceText,
      generationMode,
      style: style as PptStyle,
      tone: tone as PptTone,
      template: generationMode === "TEMPLATE" ? template : undefined,
      slideCount: Number(slideCount),
      model: model || undefined,
    }),
    [topic, audience, sourceText, generationMode, style, tone, template, slideCount, model]
  );

  const validateGenerateRequest = useCallback(() => {
    if (!generationInput.topic.trim()) {
      toast.error("请输入 PPT 主题");
      return false;
    }
    if (!hasModels) {
      toast.error("PPT 模型尚未配置，请先在 API 设置中配置 PPT 文本模型");
      return false;
    }
    return true;
  }, [generationInput, hasModels]);

  const handleGenerateOutline = useCallback(() => {
    if (!validateGenerateRequest()) return;
    startTransition(async () => {
      try {
        const outline = await generatePptOutlineAction(generationInput);
        setOutlineTitle(outline.title);
        setOutlineSlides(renumberOutlineSlides(outline.slides));
        setSlideCount(String(outline.slides.length));
        toast.success("大纲已生成");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "PPT 大纲生成失败");
      }
    });
  }, [generationInput, validateGenerateRequest]);

  const handleGenerateFromOutline = useCallback(() => {
    if (!validateGenerateRequest()) return;
    const slides = renumberOutlineSlides(outlineSlides);
    if (slides.length < 3) {
      toast.error("大纲至少需要 3 页");
      return;
    }
    startTransition(async () => {
      try {
        const project = await generatePptProjectAction({
          ...generationInput,
          slideCount: slides.length,
          outlineTitle,
          outlineSlides: slides,
        });
        replaceProject(project);
        setOutlineTitle("");
        setOutlineSlides([]);
        toast.success("PPT 已生成");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "PPT 生成失败");
      }
    });
  }, [generationInput, validateGenerateRequest, outlineTitle, outlineSlides, replaceProject]);

  const handleGenerateDirectly = useCallback(() => {
    if (!validateGenerateRequest()) return;
    startTransition(async () => {
      try {
        const project = await generatePptProjectAction(generationInput);
        replaceProject(project);
        setOutlineTitle("");
        setOutlineSlides([]);
        toast.success("PPT 已生成");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "PPT 生成失败");
      }
    });
  }, [generationInput, validateGenerateRequest, replaceProject]);

  const updateOutlineSlide = useCallback((index: number, patch: Partial<PptOutlineSlide>) => {
    setOutlineSlides((prev) =>
      renumberOutlineSlides(prev.map((slide, slideIndex) => (slideIndex === index ? { ...slide, ...patch } : slide)))
    );
  }, []);

  const updateOutlineBullets = useCallback((index: number, value: string) => {
    updateOutlineSlide(index, {
      bullets: value
        .split(/\n+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 6),
    });
  }, [updateOutlineSlide]);

  const moveOutlineSlide = useCallback((index: number, direction: -1 | 1) => {
    setOutlineSlides((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return renumberOutlineSlides(next);
    });
  }, []);

  const removeOutlineSlide = useCallback((index: number) => {
    setOutlineSlides((prev) => {
      if (prev.length <= 3) return prev;
      return renumberOutlineSlides(prev.filter((_, slideIndex) => slideIndex !== index));
    });
  }, []);

  const addOutlineSlide = useCallback(() => {
    setOutlineSlides((prev) => {
      if (prev.length >= 20) return prev;
      return renumberOutlineSlides([
        ...prev,
        {
          order: prev.length + 1,
          title: `第 ${prev.length + 1} 页`,
          layout: "CONTENT",
          bullets: ["核心观点", "关键信息", "行动建议"],
          speakerNotes: "",
          visualPrompt: "",
          accent: "",
        },
      ]);
    });
  }, []);

  const setDraft = useCallback(<K extends keyof PptSlideContent>(key: K, value: PptSlideContent[K]) => {
    if (!selectedSlideWithId) return;
    setEditing((prev) => ({
      ...prev,
      [selectedSlideWithId.id]: {
        ...(prev[selectedSlideWithId.id] ?? selectedSlideWithId),
        [key]: value,
      },
    }));
  }, [selectedSlideWithId]);

  const handleSaveSlide = useCallback(() => {
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
  }, [selectedSlideWithId, draft, replaceProject]);

  const handleRewriteSlide = useCallback(() => {
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
  }, [selectedSlideWithId, rewriteInstruction, model, replaceProject]);

  const handleRegenerateVisual = useCallback(() => {
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
  }, [selectedSlideWithId, replaceProject]);

  const handleSelectProject = useCallback((project: SerializedPptProject) => {
    setActiveId(project.id);
    setSelectedSlideId(project.slides.find(hasSlideId)?.id ?? "");
  }, []);

  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      <GenerationForm
        topic={topic}
        audience={audience}
        sourceText={sourceText}
        generationMode={generationMode}
        template={template}
        style={style}
        tone={tone}
        slideCount={slideCount}
        model={model}
        models={models}
        outlineTitle={outlineTitle}
        outlineSlides={outlineSlides}
        pending={pending}
        hasModels={hasModels}
        useOwnKey={useOwnKey}
        unitCost={unitCost}
        onTopicChange={setTopic}
        onAudienceChange={setAudience}
        onSourceTextChange={setSourceText}
        onGenerationModeChange={setGenerationMode}
        onTemplateChange={setTemplate}
        onStyleChange={setStyle}
        onToneChange={setTone}
        onSlideCountChange={setSlideCount}
        onModelChange={setModel}
        onOutlineTitleChange={setOutlineTitle}
        onUpdateOutlineSlide={updateOutlineSlide}
        onUpdateOutlineBullets={updateOutlineBullets}
        onMoveOutlineSlide={moveOutlineSlide}
        onRemoveOutlineSlide={removeOutlineSlide}
        onAddOutlineSlide={addOutlineSlide}
        onGenerateOutline={handleGenerateOutline}
        onGenerateFromOutline={handleGenerateFromOutline}
        onGenerateDirectly={handleGenerateDirectly}
      />

      <SlidePanel
        active={active}
        draft={draft}
        selectedSlideId={selectedSlideWithId?.id ?? ""}
        onSelectSlide={setSelectedSlideId}
      />

      <SlideEditor
        draft={draft}
        pending={pending}
        rewriteInstruction={rewriteInstruction}
        onDraftChange={setDraft}
        onRewriteInstructionChange={setRewriteInstruction}
        onSave={handleSaveSlide}
        onRegenerateVisual={handleRegenerateVisual}
        onRewrite={handleRewriteSlide}
      />

      <RecentProjects projects={projects} activeId={active?.id ?? ""} onSelect={handleSelectProject} />
    </div>
  );
}
