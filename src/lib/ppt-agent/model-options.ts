export const PPT_THINKING_LEVELS = [
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type PptThinkingLevel = (typeof PPT_THINKING_LEVELS)[number];

export interface PptModelOptions {
	thinkingLevel: PptThinkingLevel;
}

const DEFAULT_PPT_MODEL_OPTIONS: PptModelOptions = {
	thinkingLevel: "medium",
};

export function parsePptModelOptions(value?: string | null): PptModelOptions {
	if (!value) return DEFAULT_PPT_MODEL_OPTIONS;

	try {
		const parsed = JSON.parse(value) as { thinkingLevel?: unknown };
		return {
			thinkingLevel: normalizePptThinkingLevel(parsed.thinkingLevel),
		};
	} catch {
		return DEFAULT_PPT_MODEL_OPTIONS;
	}
}

export function pptModelOptionsToJson(options?: Partial<PptModelOptions>) {
	return JSON.stringify({
		thinkingLevel: normalizePptThinkingLevel(options?.thinkingLevel),
	});
}

export function normalizePptThinkingLevel(value: unknown): PptThinkingLevel {
	if (
		typeof value === "string" &&
		PPT_THINKING_LEVELS.includes(value as PptThinkingLevel)
	) {
		return value as PptThinkingLevel;
	}
	return DEFAULT_PPT_MODEL_OPTIONS.thinkingLevel;
}
