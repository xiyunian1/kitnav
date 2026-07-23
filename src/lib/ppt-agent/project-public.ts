import {
	resolvePptActiveGenerationTiming,
	resolvePptConfirmationTiming,
	type PptActiveGenerationTimingState,
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
    PptConfirmationTimingState &
    PptActiveGenerationTimingState & { error?: unknown; params?: unknown },
>(project: T) {
  const publicProject = { ...project } as Record<string, unknown>;
  for (const key of [
    "pptxPath",
    "logs",
    "confirmationWaitSeconds",
    "confirmationWaitStartedAt",
    "activeGenerationSeconds",
    "activeGenerationStartedAt",
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
  const activeTiming = resolvePptActiveGenerationTiming({
    activeGenerationSeconds: project.activeGenerationSeconds,
    activeGenerationStartedAt: project.activeGenerationStartedAt,
  });
  return {
    ...publicProject,
    ...timing,
    ...activeTiming,
    hasPptx: Boolean(project.pptxPath && !project.artifactsDeletedAt),
  } as Omit<
    T,
    | "pptxPath"
    | "logs"
    | "confirmationWaitSeconds"
    | "confirmationWaitStartedAt"
    | "activeGenerationSeconds"
    | "activeGenerationStartedAt"
    | "error"
    | "params"
  > &
    ReturnType<typeof resolvePptConfirmationTiming> &
    ReturnType<typeof resolvePptActiveGenerationTiming> & { hasPptx: boolean };
}
