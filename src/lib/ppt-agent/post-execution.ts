export interface PptPostExecutionGates {
	visualReview: boolean;
	verifyCharts: (reason: "initial" | "after-visual-review") => Promise<void>;
	verifyOutput: () => Promise<void>;
	assertChartEvidence: () => void;
	runVisualReview?: () => Promise<void>;
	onChartEvidenceInvalid?: () => Promise<void>;
}

export async function runPptPostExecutionGates(
	input: PptPostExecutionGates,
) {
	await input.verifyCharts("initial");
	await input.verifyOutput();
	input.assertChartEvidence();
	if (!input.visualReview) return;
	if (!input.runVisualReview) {
		throw new Error("PPT 视觉复核已开启，但缺少视觉复核执行器。");
	}

	await input.runVisualReview();
	await input.verifyOutput();
	try {
		input.assertChartEvidence();
	} catch {
		await input.onChartEvidenceInvalid?.();
		await input.verifyCharts("after-visual-review");
		await input.verifyOutput();
		input.assertChartEvidence();
	}
}
