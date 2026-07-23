import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertPptPlanningDecisionApplied,
	assertPptPlanningRecommendations,
	markStoredPptPlanningConfirmed,
	normalizeStoredPptPlanningTypography,
	readPptPlanningRecommendations,
	readPptPlanningResult,
	resolvePptPlanningSelection,
	validatePptPlanningDecision,
	writeAutomaticPptPlanningDecision,
	writePptPlanningDecision,
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

	it("normalizes generated typography to PowerPoint-safe exported fonts", () => {
		const root = createRecommendations();
		const path = join(root, "analysis", "hosted_confirmation.json");
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		raw.typography[0].heading =
			"'Aptos Display', 'Microsoft YaHei UI', 'Noto Sans CJK SC', sans-serif";
		raw.typography[0].body =
			"Aptos, 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
		writeFileSync(path, JSON.stringify(raw));

		expect(normalizeStoredPptPlanningTypography(root)).toBe(2);
		const stored = JSON.parse(readFileSync(path, "utf-8"));
		expect(stored.typography[0]).toMatchObject({
			heading:
				'"Arial Black", "Microsoft YaHei", sans-serif',
			body:
				'Arial, "Microsoft YaHei", "PingFang SC", sans-serif',
		});
		expect(JSON.stringify(stored.typography)).not.toMatch(
			/Aptos|YaHei UI|Noto/i,
		);
		expect(normalizeStoredPptPlanningTypography(root)).toBe(0);
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
		});
	});

	it("stores a complete user selection with edited page planning", () => {
		const root = createRecommendations();
		const recommendations = readPptPlanningRecommendations(root);
		const pagePlan = recommendations.pagePlan.map((page) =>
			page.page === 2
				? {
						...page,
						title: "Edited page title",
						purpose: "Edited page purpose",
						rhythm: "dense" as const,
						layoutFamily: "comparison",
					}
				: page,
		);
		const decision = validatePptPlanningDecision(recommendations, {
			directionId: "bold",
			paletteId: "vivid",
			typographyId: "strong",
			imageStrategyId: "none",
			pagePlan,
		});

		writePptPlanningDecision(root, decision, "user");

		const result = readPptPlanningResult(root);
		expect(result.source).toBe("user");
		expect(resolvePptPlanningSelection(recommendations, result).pagePlan[1]).toMatchObject({
			title: "Edited page title",
			purpose: "Edited page purpose",
			rhythm: "dense",
			layoutFamily: "comparison",
		});
	});

	it("rejects an edited page plan with a changed page order", () => {
		const root = createRecommendations();
		const recommendations = readPptPlanningRecommendations(root);
		const reversed = [...recommendations.pagePlan].reverse();

		expect(() =>
			validatePptPlanningDecision(recommendations, {
				directionId: "safe",
				paletteId: "light",
				typographyId: "clean",
				imageStrategyId: "none",
				pagePlan: reversed,
			}),
		).toThrow("顺序不正确");
	});

	it("requires edited page details to be applied after user confirmation", () => {
		const root = createRecommendations();
		const recommendations = readPptPlanningRecommendations(root);
		const pagePlan = recommendations.pagePlan.map((page) =>
			page.page === 2
				? {
						...page,
						title: "Edited page title",
						purpose: "Edited page purpose",
						layoutFamily: "comparison",
					}
				: page,
		);
		const designSpecPath = join(root, "design_spec.md");
		writeFileSync(designSpecPath, "# Initial design\n");
		writeRecommendedSpecLock(root);
		writePptPlanningDecision(
			root,
			{
				directionId: "safe",
				paletteId: "light",
				typographyId: "clean",
				imageStrategyId: "none",
				pagePlan,
			},
			"user",
		);

		expect(() => assertPptPlanningDecisionApplied(root)).toThrow(
			"尚未经过规划修订",
		);

		writeFileSync(
			designSpecPath,
			"# Updated design\n\nEdited page title\nEdited page purpose\ncomparison\n",
		);
		const afterConfirmation = new Date(Date.now() + 2_000);
		utimesSync(designSpecPath, afterConfirmation, afterConfirmation);
		expect(assertPptPlanningDecisionApplied(root).pagePlan[1]).toMatchObject({
			title: "Edited page title",
			purpose: "Edited page purpose",
			layoutFamily: "comparison",
		});
	});

	it("checks that the confirmed design is applied to the execution lock", () => {
		const root = createRecommendations();
		writeAutomaticPptPlanningDecision(root);
		writeFileSync(join(root, "design_spec.md"), "# Design\n");
		writeRecommendedSpecLock(root);
		expect(assertPptPlanningDecisionApplied(root).palette.id).toBe("light");
	});
});

function writeRecommendedSpecLock(root: string) {
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
}
