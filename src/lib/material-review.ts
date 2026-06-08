import type { MaterialStatus, MaterialType, MaterialVisibility } from "@prisma/client";
import { getSetting } from "./credits";
import { DEFAULT_SETTINGS, SETTING_KEYS } from "./settings-config";

export const MATERIAL_REVIEW_MODES = ["manual", "auto", "unrestricted"] as const;

export type MaterialReviewMode = (typeof MATERIAL_REVIEW_MODES)[number];

export const MATERIAL_REVIEW_MODE_LABELS: Record<MaterialReviewMode, string> = {
  manual: "手动审核",
  auto: "自动审核",
  unrestricted: "不限制",
};

export interface MaterialReviewInput {
  type: MaterialType;
  title: string;
  description?: string | null;
  tags?: string | null;
  promptText?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface MaterialSubmissionState {
  visibility: MaterialVisibility;
  status: MaterialStatus;
  rejectionReason: string | null;
  reviewedAt: Date | null;
}

const RISK_KEYWORDS = [
  "成人视频",
  "裸照",
  "色情",
  "未成年",
  "萝莉",
  "血腥",
  "暴恐",
  "恐怖袭击",
  "毒品",
  "赌博",
  "诈骗",
];

export function normalizeMaterialReviewMode(value?: string | null): MaterialReviewMode {
  return MATERIAL_REVIEW_MODES.includes(value as MaterialReviewMode)
    ? (value as MaterialReviewMode)
    : (DEFAULT_SETTINGS[SETTING_KEYS.MATERIAL_REVIEW_MODE] as MaterialReviewMode);
}

export async function getMaterialReviewMode() {
  return normalizeMaterialReviewMode(await getSetting(SETTING_KEYS.MATERIAL_REVIEW_MODE));
}

function runAutoReview(input: MaterialReviewInput): string | null {
  if (!input.title.trim()) return "自动审核未通过：素材标题不能为空";
  if (input.type === "IMAGE" && input.mimeType && !input.mimeType.startsWith("image/")) {
    return "自动审核未通过：文件类型不是图片";
  }
  if (input.type === "PROMPT" && !input.promptText?.trim()) {
    return "自动审核未通过：提示词内容不能为空";
  }

  const searchable = [
    input.title,
    input.description,
    input.tags,
    input.promptText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hit = RISK_KEYWORDS.find((keyword) => searchable.includes(keyword.toLowerCase()));
  return hit ? `自动审核未通过：包含风险词“${hit}”` : null;
}

export async function resolveMaterialSubmissionState(
  visibility: MaterialVisibility,
  input: MaterialReviewInput
): Promise<MaterialSubmissionState> {
  if (visibility !== "PUBLIC") {
    return {
      visibility: "PRIVATE",
      status: "DRAFT",
      rejectionReason: null,
      reviewedAt: null,
    };
  }

  const mode = await getMaterialReviewMode();
  if (mode === "manual") {
    return {
      visibility: "PUBLIC",
      status: "PENDING_REVIEW",
      rejectionReason: null,
      reviewedAt: null,
    };
  }

  if (mode === "unrestricted") {
    return {
      visibility: "PUBLIC",
      status: "APPROVED",
      rejectionReason: null,
      reviewedAt: new Date(),
    };
  }

  const rejectionReason = runAutoReview(input);
  return rejectionReason
    ? {
        visibility: "PRIVATE",
        status: "REJECTED",
        rejectionReason,
        reviewedAt: new Date(),
      }
    : {
        visibility: "PUBLIC",
        status: "APPROVED",
        rejectionReason: null,
        reviewedAt: new Date(),
      };
}
