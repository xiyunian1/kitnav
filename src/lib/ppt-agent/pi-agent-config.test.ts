import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildOpenAiCompatibleCompat,
	buildThinkingLevelMap,
	cleanupPptPiAgentConfig,
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

	it("removes task-scoped config directories after the agent exits", () => {
		const configDir = mkdtempSync(join(tmpdir(), "ppt-pi-test-"));
		cleanupPptPiAgentConfig({
			configDir,
			provider: "test",
			model: "test-model",
			apiKey: "test-key",
			thinkingLevel: "medium",
			source: "platform",
			supportsVision: false,
		});
		expect(existsSync(configDir)).toBe(false);
	});
});
