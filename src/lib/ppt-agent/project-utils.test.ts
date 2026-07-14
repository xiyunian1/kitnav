import { describe, expect, it } from "vitest";
import {
	assertPptSourceMarkdownLength,
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
