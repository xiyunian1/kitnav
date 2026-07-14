export interface PptxArtifactState {
  pptxPath: string | null;
  artifactsDeletedAt?: Date | string | null;
}

export function hasPptxArtifact(project: PptxArtifactState) {
  return Boolean(project.pptxPath && !project.artifactsDeletedAt);
}

export function toPublicPptProject<T extends PptxArtifactState>(project: T) {
  const { pptxPath, ...publicProject } = project;
  return {
    ...publicProject,
    hasPptx: Boolean(pptxPath && !project.artifactsDeletedAt),
  } as Omit<T, "pptxPath"> & { hasPptx: boolean };
}
