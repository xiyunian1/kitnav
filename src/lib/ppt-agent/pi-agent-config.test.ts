import { describe, expect, it } from "vitest";
import {
	buildOpenAiCompatibleCompat,
	buildThinkingLevelMap,
} from "./pi-agent-config";

describe("PPT pi agent reasoning config", () => {
	it("sends all four UI thinking levels unchanged by default", () => {
		expect(buildThinkingLevelMap({})).toEqual({
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
		});
		expect(buildOpenAiCompatibleCompat({}).supportsReasoningEffort).toBe(true);
	});

	it("allows incompatible upstreams to override reasoning behavior", () => {
		expect(
			buildOpenAiCompatibleCompat({
				PPT_PI_SUPPORTS_REASONING_EFFORT: "false",
			}).supportsReasoningEffort,
		).toBe(false);
		expect(
			buildThinkingLevelMap({ PPT_PI_THINKING_VALUE: "max" }).xhigh,
		).toBe("max");
	});
});
