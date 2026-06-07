export const PPT_STYLES = [
  { value: "BUSINESS", label: "商务汇报" },
  { value: "MINIMAL", label: "极简白底" },
  { value: "TECH", label: "科技产品" },
  { value: "EDUCATION", label: "教学培训" },
  { value: "PITCH", label: "融资路演" },
] as const;

export const PPT_TONES = [
  { value: "PROFESSIONAL", label: "专业稳重" },
  { value: "PERSUASIVE", label: "说服力强" },
  { value: "CLEAR", label: "清晰易懂" },
  { value: "STORY", label: "故事化" },
] as const;

export type PptStyle = (typeof PPT_STYLES)[number]["value"];
export type PptTone = (typeof PPT_TONES)[number]["value"];

export interface PptSlideContent {
  id?: string;
  order: number;
  title: string;
  subtitle?: string;
  layout: "COVER" | "AGENDA" | "CONTENT" | "SECTION" | "COMPARISON" | "TIMELINE" | "SUMMARY" | "THANKS";
  bullets: string[];
  speakerNotes?: string;
  visualPrompt?: string;
  accent?: string;
  imageUrl?: string;
  imagePrompt?: string;
  imageModel?: string;
  imageStatus?: "PENDING" | "SUCCESS" | "FAILED" | "";
  imageError?: string;
  imageDurationMs?: number | null;
}

export interface PptTheme {
  primary: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  font: string;
}

export interface SerializedPptProject {
  id: string;
  title: string;
  topic: string;
  audience: string;
  style: string;
  tone: string;
  slideCount: number;
  sourceText: string;
  status: string;
  model: string;
  theme: PptTheme;
  creditsCost: number;
  usedOwnKey: boolean;
  createdAt: string;
  updatedAt: string;
  slides: PptSlideContent[];
}
