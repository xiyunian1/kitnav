import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	readPptPlanningRecommendations,
	readPptPlanningResult,
} from "./planning-confirmation";
import { extractSvgVisibleText } from "./svg-layout-analyze";

export function findConfirmedPptPageTitleIssues(projectDir: string) {
	const svgDir = join(projectDir, "svg_output");
	if (!existsSync(svgDir)) return [];

	let recommendations;
	let result;
	try {
		recommendations = readPptPlanningRecommendations(projectDir);
		result = readPptPlanningResult(projectDir);
	} catch {
		return [];
	}
	if (result.source !== "user" || !result.pagePlan) return [];

	const svgFiles = readdirSync(svgDir)
		.filter((file) => file.toLowerCase().endsWith(".svg"))
		.sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
	const issues: string[] = [];
	for (const page of result.pagePlan) {
		const recommended = recommendations.pagePlan[page.page - 1];
		if (!recommended || page.title === recommended.title) continue;
		const svgFile = svgFiles.find((file) => parseSlideNumber(file) === page.page);
		if (!svgFile) continue;
		const visibleText = normalizeComparableText(
			extractSvgVisibleText(readFileSync(join(svgDir, svgFile), "utf-8")),
		);
		if (!visibleText.includes(normalizeComparableText(page.title))) {
			issues.push(
				`${svgFile}：未保留用户确认的第 ${page.page} 页标题“${page.title}”`,
			);
		}
	}
	return issues;
}

function normalizeComparableText(value: string) {
	return value.normalize("NFKC").replace(/\s+/g, "");
}

function parseSlideNumber(file: string) {
	const leading = file.match(/^(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	const named = file.match(/(?:^|[_-])slide[_-]?(\d{1,3})(?:[_-]|\.svg$)/i)?.[1];
	return Number(leading || named || 0);
}
