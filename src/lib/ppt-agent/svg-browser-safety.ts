export const SVG_BROWSER_CONTENT_SECURITY_POLICY = [
  "sandbox",
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
].join("; ");

/** Removes active content while preserving normal PPT preview markup. */
export function sanitizeSvgForBrowser(svg: string): string {
  return svg
    .replace(/<!DOCTYPE[^<>]*(?:\[[\s\S]*?\]\s*)?>/gi, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(foreignObject|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*')/gi, "")
    .replace(
      /\s+(?:href|xlink:href)\s*=\s*(["'])\s*(?:javascript:|data:text\/html|https?:|\/\/)[\s\S]*?\1/gi,
      "",
    )
    .replace(/url\(\s*(["']?)\s*(?:javascript:|data:text\/html|https?:|\/\/)[^)]*\)/gi, "none");
}
