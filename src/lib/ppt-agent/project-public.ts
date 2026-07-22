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
  T extends PptxArtifactState &
    PptConfirmationTimingState & { error?: unknown; params?: unknown },
>(project: T) {
  const publicProject = { ...project } as Record<string, unknown>;
  for (const key of [
    "pptxPath",
    "logs",
    "confirmationWaitSeconds",
    "confirmationWaitStartedAt",
    "error",
    "params",
  ]) {
    delete publicProject[key];
  }
  const timing = resolvePptConfirmationTiming({
    logs: project.logs,
    confirmationWaitSeconds: project.confirmationWaitSeconds,
    confirmationWaitStartedAt: project.confirmationWaitStartedAt,
  });
  return {
    ...publicProject,
    ...timing,
    hasPptx: Boolean(project.pptxPath && !project.artifactsDeletedAt),
  } as Omit<
    T,
    | "pptxPath"
    | "logs"
    | "confirmationWaitSeconds"
    | "confirmationWaitStartedAt"
    | "error"
    | "params"
  > &
    ReturnType<typeof resolvePptConfirmationTiming> & { hasPptx: boolean };
}
