import { describe, expect, it } from "vitest";
import {
	assertPptSourceMarkdownLength,
	isThinPptSource,
	MAX_PPT_SOURCE_MARKDOWN_CHARS,
} from "./project-utils";

describe("assertPptSourceMarkdownLength", () => {
	it("accepts source content at the model context limit", () => {
		const source = "a".repeat(MAX_PPT_SOURCE_MARKDOWN_CHARS);
		expect(assertPptSourceMarkdownLength(source)).toBe(source);
	});

	it("rejects source content that would overfill the model context", () => {
		expect(() =>
			assertPptSourceMarkdownLength(
				"a".repeat(MAX_PPT_SOURCE_MARKDOWN_CHARS + 1),
			),
		).toThrow("超过 8 万字符");
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
