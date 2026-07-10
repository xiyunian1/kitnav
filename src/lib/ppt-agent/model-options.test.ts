import { describe, expect, it } from "vitest";
import {
	isPptVisionModel,
	parsePptModelOptions,
	pptModelOptionsToJson,
} from "./model-options";

describe("PPT model options", () => {
	it("keeps visual capability scoped to explicitly selected models", () => {
		const options = parsePptModelOptions(
			pptModelOptionsToJson({
				thinkingLevel: "high",
				visionModels: ["vision-model", "vision-model", "  "],
			}),
		);

		expect(options).toEqual({
			thinkingLevel: "high",
			visionModels: ["vision-model"],
		});
		expect(isPptVisionModel(options, "vision-model")).toBe(true);
		expect(isPptVisionModel(options, "text-model")).toBe(false);
	});

	it("defaults existing configurations to text-only", () => {
		expect(parsePptModelOptions('{"thinkingLevel":"medium"}')).toEqual({
			thinkingLevel: "medium",
			visionModels: [],
		});
	});
});
