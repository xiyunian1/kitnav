import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertPptPlanningDecisionApplied,
	assertPptPlanningRecommendations,
	assertPptPlanningStageDerived,
	markStoredPptPlanningConfirmed,
	markStoredPptPlanningStage,
	readPptPlanningDraft,
	readPptPlanningRecommendations,
	readPptPlanningResult,
	resolvePptPlanningSelection,
	validatePptPlanningDecision,
	validatePptPlanningDesignSystem,
	validatePptPlanningDirection,
	validatePptPlanningExecution,
	writeAutomaticPptPlanningDecision,
	writePptPlanningDraft,
} from "./planning-confirmation";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createRecommendations() {
	const root = mkdtempSync(join(tmpdir(), "ppt-planning-confirmation-"));
	roots.push(root);
	mkdirSync(join(root, "analysis"));
	const directions = ["safe", "shifted", "bold"].map((id) => ({
		id,
		label: id,
		mode: "briefing",
		visualStyle: "swiss-minimal",
		deliveryPurpose: "balanced",
		rationale: `${id} direction`,
	}));
	const palettes = ["light", "cool", "vivid"].map((id) => ({
		id,
		label: id,
		background: "#FFFFFF",
		secondaryBackground: "#F3F4F6",
		primary: "#111827",
		accent: "#2563EB",
		bodyText: "#1F2937",
		rationale: `${id} palette`,
	}));
	const typography = ["clean", "editorial", "strong"].map((id) => ({
		id,
		label: id,
		heading: "Microsoft YaHei",
		body: "Microsoft YaHei",
		bodySize: 24,
		rationale: `${id} type`,
	}));
	writeFileSync(
		join(root, "analysis", "hosted_confirmation.json"),
		JSON.stringify({
			schema: "ppt_hosted_planning_recommendations.v1",
			summary: "summary",
			directions,
			palettes,
			typography,
			imageStrategies: [
				{
					id: "none",
					label: "none",
					usage: ["none"],
					rendering: "none",
					palette: "deck",
					rationale: "no generated images",
				},
			],
			pagePlan: Array.from({ length: 3 }, (_, index) => ({
				page: index + 1,
				title: `Page ${index + 1}`,
				purpose: "purpose",
				rhythm: "anchor",
				layoutFamily: "hero",
			})),
			recommendedDirectionId: "safe",
			recommendedPaletteId: "light",
			recommendedTypographyId: "clean",
			recommendedImageStrategyId: "none",
		}),
	);
	return root;
}

describe("PPT planning confirmation", () => {
	it("validates candidate references and writes the automatic decision", () => {
		const root = createRecommendations();
		const recommendations = assertPptPlanningRecommendations(root, {
			expectedSlideCount: 3,
			allowAiImages: false,
		});
		expect(recommendations.directions).toHaveLength(3);
		expect(writeAutomaticPptPlanningDecision(root)).toContain(
			"hosted_confirmation_result.json",
		);
		expect(readPptPlanningResult(root).source).toBe("automatic");
		expect(
			resolvePptPlanningSelection(recommendations, readPptPlanningResult(root))
				.direction.id,
		).toBe("safe");
	});

	it("rejects a stale user selection", () => {
		const root = createRecommendations();
		const recommendations = readPptPlanningRecommendations(root);
		expect(() =>
			validatePptPlanningDecision(recommendations, {
				directionId: "missing",
				paletteId: "light",
				typographyId: "clean",
				imageStrategyId: "none",
			}),
		).toThrow("已失效");
	});

	it("rejects a page plan that does not match the requested slide count", () => {
		const root = createRecommendations();
		expect(() =>
			assertPptPlanningRecommendations(root, {
				expectedSlideCount: 4,
				allowAiImages: false,
			}),
		).toThrow("页数不正确");
	});

	it("normalizes the legacy no-image strategy emitted by the strategist", () => {
		const root = createRecommendations();
		const path = join(root, "analysis", "hosted_confirmation.json");
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		raw.imageStrategies = [
			{
				id: "no-images-native-diagrams",
				usage: "none",
				rationale: "Use native SVG diagrams instead of images.",
			},
		];
		raw.recommendedImageStrategyId = "no-images-native-diagrams";
		writeFileSync(path, JSON.stringify(raw));

		expect(readPptPlanningRecommendations(root).imageStrategies).toEqual([
			{
				id: "no-images-native-diagrams",
				label: "不使用图片",
				usage: ["none"],
				rendering: "not-applicable",
				palette: "not-applicable",
				rationale: "Use native SVG diagrams instead of images.",
			},
		]);
	});

	it("keeps incomplete AI image strategies invalid", () => {
		const root = createRecommendations();
		const path = join(root, "analysis", "hosted_confirmation.json");
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		raw.imageStrategies = [
			{
				id: "generated-illustrations",
				usage: "ai",
				rationale: "Generate supporting illustrations.",
			},
		];
		raw.recommendedImageStrategyId = "generated-illustrations";
		writeFileSync(path, JSON.stringify(raw));

		expect(() => readPptPlanningRecommendations(root)).toThrow(
			"无法读取有效的 PPT 设计候选",
		);
	});

	it("marks stored generation parameters for resume without dropping fields", () => {
		expect(
			JSON.parse(
				markStoredPptPlanningConfirmed(
					JSON.stringify({ prompt: "topic", confirmDesign: true }),
				),
			),
			).toEqual({
				prompt: "topic",
				confirmDesign: true,
				planningConfirmed: true,
				planningConfirmationStage: "complete",
			});
			expect(
				JSON.parse(
					markStoredPptPlanningStage(
						JSON.stringify({ prompt: "topic", confirmDesign: true }),
						"design-system",
					),
				),
			).toMatchObject({
				planningConfirmed: false,
				planningConfirmationStage: "design-system",
			});
		});

		it("validates staged choices and requires downstream derivation evidence", () => {
			const root = createRecommendations();
			let recommendations = readPptPlanningRecommendations(root);
			const directionId = validatePptPlanningDirection(recommendations, "safe");
			writePptPlanningDraft(root, { nextStage: "design-system", directionId });
			const designDraft = readPptPlanningDraft(root);
			const designSystem = validatePptPlanningDesignSystem(
				recommendations,
				designDraft,
				{ paletteId: "light", typographyId: "clean" },
			);
			writePptPlanningDraft(root, {
				nextStage: "execution",
				directionId,
				...designSystem,
			});

			const recommendationPath = join(
				root,
				"analysis",
				"hosted_confirmation.json",
			);
			const raw = JSON.parse(readFileSync(recommendationPath, "utf-8"));
			raw.derivation = {
				stage: "execution",
				directionId,
				paletteId: "light",
				typographyId: "clean",
				derivedAt: new Date().toISOString(),
			};
			writeFileSync(recommendationPath, JSON.stringify(raw));
			recommendations = readPptPlanningRecommendations(root);
			const executionDraft = readPptPlanningDraft(root);
			expect(
				assertPptPlanningStageDerived(
					recommendations,
					executionDraft,
					"execution",
				).derivation?.stage,
			).toBe("execution");
			expect(
				validatePptPlanningExecution(recommendations, executionDraft, "none"),
			).toEqual({
				directionId: "safe",
				paletteId: "light",
				typographyId: "clean",
				imageStrategyId: "none",
			});
		});

	it("checks that the confirmed design is applied to the execution lock", () => {
		const root = createRecommendations();
		writeAutomaticPptPlanningDecision(root);
		writeFileSync(join(root, "design_spec.md"), "# Design\n");
		writeFileSync(
			join(root, "spec_lock.md"),
			[
				"## mode",
				"- mode: briefing",
				"## visual_style",
				"- visual_style: swiss-minimal",
				"## colors",
				"- bg: #FFFFFF",
				"- secondary_bg: #F3F4F6",
				"- primary: #111827",
				"- accent: #2563EB",
				"- text: #1F2937",
				"## typography",
				"- title_family: Microsoft YaHei",
				"- body_family: Microsoft YaHei",
				"- body: 24",
				"## page_rhythm",
				"- P01: anchor",
				"- P02: anchor",
				"- P03: anchor",
			].join("\n"),
		);
		expect(assertPptPlanningDecisionApplied(root).palette.id).toBe("light");
	});
});
