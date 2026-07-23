import { describe, expect, it } from "vitest";
import { parsePptSvgQualityMessages } from "./python-tools";

describe("PPT SVG quality output parsing", () => {
	it("reads current bracketed checker messages without treating summaries as issues", () => {
		const output = [
			"[WARN] 01.svg - Passed (with warnings)",
			"   [WARN] Font stack exports non-PPT-safe typeface(s) to PPTX (latin=Aptos)",
			"  [WARN] With warnings: 1 (100%)",
			"  [ERROR] With errors: 0 (0%)",
		].join("\n");

		expect(parsePptSvgQualityMessages(output, "warning")).toEqual([
			"01.svg - Passed (with warnings)",
			"Font stack exports non-PPT-safe typeface(s) to PPTX (latin=Aptos)",
		]);
		expect(parsePptSvgQualityMessages(output, "error")).toEqual([]);
	});

	it("keeps compatibility with the legacy colon format", () => {
		expect(
			parsePptSvgQualityMessages(
				"ERROR: invalid SVG\nWARNING: low resolution",
				"error",
			),
		).toEqual(["invalid SVG"]);
		expect(
			parsePptSvgQualityMessages(
				"ERROR: invalid SVG\nWARNING: low resolution",
				"warning",
			),
		).toEqual(["low resolution"]);
	});
});
