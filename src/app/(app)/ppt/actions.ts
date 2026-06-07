"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  generatePptProject,
  getPptProject,
  listPptProjects,
  regeneratePptSlideVisual,
  rewritePptSlide,
  updatePptSlide,
  type PptSlideContent,
  type PptStyle,
  type PptTone,
} from "@/lib/ppt";

function requireUserId(userId?: string) {
  if (!userId) throw new Error("请先登录");
  return userId;
}

export async function listPptProjectsAction() {
  const session = await auth();
  return listPptProjects(requireUserId(session?.user?.id));
}

export async function getPptProjectAction(id: string) {
  const session = await auth();
  return getPptProject(requireUserId(session?.user?.id), id);
}

export async function generatePptProjectAction(input: {
  topic: string;
  audience?: string;
  style: PptStyle;
  tone: PptTone;
  slideCount: number;
  sourceText?: string;
  model?: string;
}) {
  const session = await auth();
  const userId = requireUserId(session?.user?.id);
  const project = await generatePptProject({
    userId,
    topic: input.topic.trim(),
    audience: input.audience?.trim(),
    style: input.style,
    tone: input.tone,
    slideCount: input.slideCount,
    sourceText: input.sourceText?.trim(),
    model: input.model,
  });
  revalidatePath("/ppt");
  return project;
}

export async function updatePptSlideAction(
  slideId: string,
  input: {
    title?: string;
    subtitle?: string;
    layout?: PptSlideContent["layout"];
    bullets?: string[];
    speakerNotes?: string;
    visualPrompt?: string;
    accent?: string;
  }
) {
  const session = await auth();
  const project = await updatePptSlide(requireUserId(session?.user?.id), slideId, input);
  revalidatePath("/ppt");
  return project;
}

export async function rewritePptSlideAction(slideId: string, instruction: string, model?: string) {
  const session = await auth();
  const project = await rewritePptSlide(
    requireUserId(session?.user?.id),
    slideId,
    instruction.trim(),
    model
  );
  revalidatePath("/ppt");
  return project;
}

export async function regeneratePptSlideVisualAction(slideId: string) {
  const session = await auth();
  const project = await regeneratePptSlideVisual(requireUserId(session?.user?.id), slideId);
  revalidatePath("/ppt");
  return project;
}
