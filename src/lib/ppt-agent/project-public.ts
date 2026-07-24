import {
	resolvePptActiveGenerationTiming,
	resolvePptConfirmationTiming,
	type PptActiveGenerationTimingState,
	type PptConfirmationTimingState,
} from "./timing";
import {
  getGeneratedArtifactExpiresAt,
  isGeneratedArtifactExpired,
} from "@/lib/generated-artifact-retention";
import { isPptCompletedStatus } from "./status";

export interface PptArtifactState {
  status?: string | null;
  completedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  artifactsDeletedAt?: Date | string | null;
}

export interface PptxArtifactState extends PptArtifactState {
  pptxPath: string | null;
}

function pptArtifactCompletedAt(project: PptArtifactState) {
  if (
    !isPptCompletedStatus(project.status) &&
    project.status !== "FAILED"
  ) {
    return null;
  }
  return project.completedAt ?? project.updatedAt ?? null;
}

export function getPptArtifactExpiresAt(project: PptArtifactState) {
  return getGeneratedArtifactExpiresAt(pptArtifactCompletedAt(project));
}

export function arePptArtifactsExpired(
  project: PptArtifactState,
  now = Date.now(),
) {
  return Boolean(
    project.artifactsDeletedAt ||
      isGeneratedArtifactExpired(pptArtifactCompletedAt(project), now),
  );
}

export function hasPptxArtifact(
  project: PptxArtifactState,
  now = Date.now(),
) {
  return Boolean(project.pptxPath && !arePptArtifactsExpired(project, now));
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
  const artifactExpiresAt = getPptArtifactExpiresAt(project);
  const artifactsExpired = arePptArtifactsExpired(project);
  return {
    ...publicProject,
    ...timing,
    ...activeTiming,
    artifactExpiresAt: artifactExpiresAt?.toISOString() ?? null,
    artifactsExpired,
    hasPptx: Boolean(project.pptxPath && !artifactsExpired),
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
    ReturnType<typeof resolvePptActiveGenerationTiming> & {
      artifactExpiresAt: string | null;
      artifactsExpired: boolean;
      hasPptx: boolean;
    };
}
