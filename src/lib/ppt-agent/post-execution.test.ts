import { describe, expect, it } from "vitest";
import { runPptPostExecutionGates } from "./post-execution";

describe("PPT hosted post-execution gates", () => {
	it("runs chart verification before export gates when review is disabled", async () => {
		const calls: string[] = [];
		const record = async (value: string) => {
			calls.push(value);
		};
		await runPptPostExecutionGates({
			visualReview: false,
			verifyCharts: (reason) => record(`charts:${reason}`),
			verifyOutput: () => record("verify-output"),
			assertChartEvidence: () => calls.push("assert-charts"),
		});
		expect(calls).toEqual([
			"charts:initial",
			"verify-output",
			"assert-charts",
		]);
	});

	it("runs opt-in visual review after the initial chart verification", async () => {
		const calls: string[] = [];
		const record = async (value: string) => {
			calls.push(value);
		};
		await runPptPostExecutionGates({
			visualReview: true,
			verifyCharts: (reason) => record(`charts:${reason}`),
			verifyOutput: () => record("verify-output"),
			assertChartEvidence: () => calls.push("assert-charts"),
			runVisualReview: () => record("visual-review"),
		});
		expect(calls).toEqual([
			"charts:initial",
			"verify-output",
			"assert-charts",
			"visual-review",
			"verify-output",
			"assert-charts",
		]);
	});

	it("reverifies charts only when visual review invalidates their hashes", async () => {
		const calls: string[] = [];
		let assertions = 0;
		const record = async (value: string) => {
			calls.push(value);
		};
		await runPptPostExecutionGates({
			visualReview: true,
			verifyCharts: (reason) => record(`charts:${reason}`),
			verifyOutput: () => record("verify-output"),
			assertChartEvidence: () => {
				assertions += 1;
				calls.push("assert-charts");
				if (assertions === 2) throw new Error("SVG hash changed");
			},
			runVisualReview: () => record("visual-review"),
			onChartEvidenceInvalid: () => record("chart-stale"),
		});
		expect(calls).toEqual([
			"charts:initial",
			"verify-output",
			"assert-charts",
			"visual-review",
			"verify-output",
			"assert-charts",
			"chart-stale",
			"charts:after-visual-review",
			"verify-output",
			"assert-charts",
		]);
	});
});
