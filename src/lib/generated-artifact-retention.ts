export const GENERATED_ARTIFACT_RETENTION_DAYS = 7;
export const GENERATED_ARTIFACT_RETENTION_MS =
  GENERATED_ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function getGeneratedArtifactExpiresAt(
  completedAt: Date | string | null | undefined,
) {
  if (!completedAt) return null;
  const completedAtMs =
    completedAt instanceof Date
      ? completedAt.getTime()
      : new Date(completedAt).getTime();
  if (!Number.isFinite(completedAtMs)) return null;
  return new Date(completedAtMs + GENERATED_ARTIFACT_RETENTION_MS);
}

export function isGeneratedArtifactExpired(
  completedAt: Date | string | null | undefined,
  now = Date.now(),
) {
  const expiresAt = getGeneratedArtifactExpiresAt(completedAt);
  return Boolean(expiresAt && expiresAt.getTime() <= now);
}
