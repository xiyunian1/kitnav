export function parseGenerationUrls(resultUrl: string | null): string[] {
  if (!resultUrl) return [];
  try {
    const parsed = JSON.parse(resultUrl);
    return Array.isArray(parsed) ? parsed : [resultUrl];
  } catch {
    return [resultUrl];
  }
}
