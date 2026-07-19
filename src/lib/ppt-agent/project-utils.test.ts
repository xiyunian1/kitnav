import { describe, expect, it } from "vitest";
import {
	assertPptSourceMarkdownLength,
	fitPptSourceMarkdown,
	isThinPptSource,
	MAX_PPT_SOURCE_MARKDOWN_CHARS,
} from "./project-utils";

describe("assertPptSourceMarkdownLength", () => {
	it("accepts source content at the model context limit", () => {
		const source = "a".repeat(MAX_PPT_SOURCE_MARKDOWN_CHARS);
		expect(assertPptSourceMarkdownLength(source)).toBe(source);
	});

	it("compacts oversized source content instead of rejecting the project", () => {
		const result = assertPptSourceMarkdownLength(
			`# 第一章\n${"a".repeat(MAX_PPT_SOURCE_MARKDOWN_CHARS)}\n# 第二章\n结论`,
		);
		expect(result.length).toBeLessThanOrEqual(MAX_PPT_SOURCE_MARKDOWN_CHARS);
		expect(result).toContain("资料导航");
		expect(result).toContain("# 第一章");
		expect(result).toContain("# 第二章");
	});

	it("preserves short source markdown exactly", () => {
		expect(fitPptSourceMarkdown("# 资料\n内容", 100)).toBe("# 资料\n内容");
	});
});

describe("isThinPptSource", () => {
	it("detects a topic-only source", () => {
		expect(isThinPptSource("# Python 学习路线")).toBe(true);
	});

	it("keeps substantive source material out of thin-source preparation", () => {
		expect(isThinPptSource(`## 资料\n${"具体内容".repeat(180)}`)).toBe(false);
	});
});
