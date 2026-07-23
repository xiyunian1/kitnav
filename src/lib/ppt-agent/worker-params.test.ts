import { describe, expect, it } from "vitest";
import { rebuildGenerationParams } from "./worker";

describe("rebuildGenerationParams", () => {
	it("rebuilds supported upload and text parameters", () => {
		expect(
			rebuildGenerationParams(
				"project-1",
				"user-1",
				JSON.stringify({
					sourceType: "markdown",
					prompt: "Create a concise deck",
					sourceFileUrls: ["/private/source.docx"],
						colorPreference: "monochrome",
						typographyPreference: "editorial",
						confirmDesign: true,
						planningConfirmed: true,
						planningConfirmationStage: "complete",
						textCreditsCost: 100,
						retryAttempt: 2,
				}),
				"lease-1",
			),
		).toMatchObject({
			projectId: "project-1",
			userId: "user-1",
			workerLease: "lease-1",
			sourceType: "markdown",
			prompt: "Create a concise deck",
			sourceFileUrls: ["/private/source.docx"],
			colorPreference: "monochrome",
				typographyPreference: "editorial",
				confirmDesign: true,
				planningConfirmed: true,
				planningConfirmationStage: "complete",
				textCreditsCost: 100,
				retryAttempt: 2,
			});
	});

	it("rejects queued legacy URL inputs instead of silently changing their meaning", () => {
		expect(() =>
			rebuildGenerationParams(
				"project-1",
				"user-1",
				JSON.stringify({
					sourceType: "url",
					sourceUrl: "https://example.com/source",
				}),
				"lease-1",
			),
		).toThrow("链接型 PPT 输入已停用");
	});

	it("rejects corrupt stored parameters", () => {
		expect(() =>
			rebuildGenerationParams(
				"project-1",
				"user-1",
				"{not-json",
				"lease-1",
			),
		).toThrow("入参损坏");
	});
});
