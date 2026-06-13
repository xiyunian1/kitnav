import {
  GORDEN_PPT_TEMPLATES,
  type PptOutlineSlide,
  type PptSlideContent,
  type SerializedPptProject,
} from "@/lib/ppt-shared";

export const TEMPLATE_LABELS = Object.fromEntries(
  GORDEN_PPT_TEMPLATES.map((item) => [item.value, item.label])
);
export const TEMPLATE_VALUES = new Set<string>(GORDEN_PPT_TEMPLATES.map((item) => item.value));
export const DEFAULT_TEMPLATE = GORDEN_PPT_TEMPLATES[0].value;

export type EditableSlide = PptSlideContent & { id: string };

export function hasSlideId(slide: PptSlideContent): slide is EditableSlide {
  return typeof slide.id === "string" && slide.id.length > 0;
}

export function getProjectTemplate(project?: SerializedPptProject | null) {
  const value = project?.template || DEFAULT_TEMPLATE;
  return TEMPLATE_VALUES.has(value) ? value : DEFAULT_TEMPLATE;
}

export function renumberOutlineSlides(slides: PptOutlineSlide[]) {
  return slides.map((slide, index) => ({ ...slide, order: index + 1 }));
}
