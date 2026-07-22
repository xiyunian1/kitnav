import {
  resolvePptConfirmationTiming,
  type PptConfirmationTimingState,
} from "./timing";

export interface PptxArtifactState {
  pptxPath: string | null;
  artifactsDeletedAt?: Date | string | null;
}

export function hasPptxArtifact(project: PptxArtifactState) {
  return Boolean(project.pptxPath && !project.artifactsDeletedAt);
}

export function toPublicPptProject<
  T extends PptxArtifactState & PptConfirmationTimingState,
>(project: T) {
  const {
    pptxPath,
    logs,
    confirmationWaitSeconds,
    confirmationWaitStartedAt,
    ...publicProject
  } = project;
  const timing = resolvePptConfirmationTiming({
    logs,
    confirmationWaitSeconds,
    confirmationWaitStartedAt,
  });
  return {
    ...publicProject,
    ...timing,
    hasPptx: Boolean(pptxPath && !project.artifactsDeletedAt),
  } as Omit<
    T,
    | "pptxPath"
    | "logs"
    | "confirmationWaitSeconds"
    | "confirmationWaitStartedAt"
  > &
    ReturnType<typeof resolvePptConfirmationTiming> & { hasPptx: boolean };
}
