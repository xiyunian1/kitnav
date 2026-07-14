import { describe, expect, it } from "vitest";
import {
  sanitizeSvgForBrowser,
  SVG_BROWSER_CONTENT_SECURITY_POLICY,
} from "./svg-browser-safety";

describe("SVG browser safety", () => {
  it("removes active content but preserves normal local preview assets", () => {
    const result = sanitizeSvgForBrowser(`
      <!DOCTYPE svg>
      <svg xmlns="http://www.w3.org/2000/svg" onload="steal()">
        <script>alert(document.cookie)</script>
        <foreignObject><iframe src="https://attacker.example"></iframe></foreignObject>
        <image href="../images/cover.png" onclick='steal()' />
        <a xlink:href="javascript:steal()"><text>Open</text></a>
        <rect style="fill:url(https://attacker.example/pixel)" />
      </svg>
    `);

    expect(result).not.toMatch(/script|foreignObject|iframe|onload|onclick|javascript:/i);
    expect(result).not.toContain("https://attacker.example");
    expect(result).toContain("../images/cover.png");
  });

  it("uses a sandboxed policy without script execution", () => {
    expect(SVG_BROWSER_CONTENT_SECURITY_POLICY).toContain("sandbox");
    expect(SVG_BROWSER_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(SVG_BROWSER_CONTENT_SECURITY_POLICY).not.toContain("script-src");
  });
});
