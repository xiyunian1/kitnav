import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findConfirmedPptPageTitleIssues } from "./confirmed-output";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("confirmed PPT output", () => {
	it("requires a user-edited page title to appear in the corresponding SVG", () => {
		const root = createProject();
		writeFileSync(
			join(root, "svg_output", "02_flow.svg"),
			'<svg><title>用户调整后的标题</title><text x="10" y="20">原始标题</text></svg>',
		);
		expect(findConfirmedPptPageTitleIssues(root)).toEqual([
			"02_flow.svg：未保留用户确认的第 2 页标题“用户调整后的标题”",
		]);

		writeFileSync(
			join(root, "svg_output", "02_flow.svg"),
			'<svg><text x="10" y="20"><tspan>用户调整后</tspan><tspan>的标题</tspan></text></svg>',
		);
		expect(findConfirmedPptPageTitleIssues(root)).toEqual([]);
	});
});

function createProject() {
	const root = mkdtempSync(join(tmpdir(), "ppt-confirmed-output-"));
	roots.push(root);
	mkdirSync(join(root, "analysis"));
	mkdirSync(join(root, "svg_output"));
	const directions = ["safe", "shifted", "bold"].map((id) => ({
		id,
		label: id,
		mode: "briefing",
		visualStyle: "swiss-minimal",
		deliveryPurpose: "balanced",
		rationale: id,
	}));
	const palettes = ["one", "two", "three"].map((id) => ({
		id,
		label: id,
		background: "#FFFFFF",
		secondaryBackground: "#F3F4F6",
		primary: "#111827",
		accent: "#2563EB",
		bodyText: "#1F2937",
		rationale: id,
	}));
	const typography = ["one", "two", "three"].map((id) => ({
		id,
		label: id,
		heading: "Microsoft YaHei",
		body: "Microsoft YaHei",
		bodySize: 24,
		rationale: id,
	}));
	const pagePlan = Array.from({ length: 3 }, (_, index) => ({
		page: index + 1,
		title: `原始标题 ${index + 1}`,
		purpose: "purpose",
		rhythm: "anchor",
		layoutFamily: "hero",
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
					rendering: "not-applicable",
					palette: "not-applicable",
					rationale: "none",
				},
			],
			pagePlan,
			recommendedDirectionId: "safe",
			recommendedPaletteId: "one",
			recommendedTypographyId: "one",
			recommendedImageStrategyId: "none",
		}),
	);
	writeFileSync(
		join(root, "analysis", "hosted_confirmation_result.json"),
		JSON.stringify({
			schema: "ppt_hosted_planning_result.v1",
			directionId: "safe",
			paletteId: "one",
			typographyId: "one",
			imageStrategyId: "none",
			pagePlan: pagePlan.map((page) =>
				page.page === 2 ? { ...page, title: "用户调整后的标题" } : page,
			),
			source: "user",
			confirmedAt: new Date().toISOString(),
		}),
	);
	return root;
}
