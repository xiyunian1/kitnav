export const PPT_THINKING_LEVELS = [
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export type PptThinkingLevel = (typeof PPT_THINKING_LEVELS)[number];

export interface PptModelOptions {
	thinkingLevel: PptThinkingLevel;
	visionModels: string[];
}

const DEFAULT_PPT_MODEL_OPTIONS: PptModelOptions = {
	thinkingLevel: "medium",
	visionModels: [],
};

export function parsePptModelOptions(value?: string | null): PptModelOptions {
	if (!value) return DEFAULT_PPT_MODEL_OPTIONS;

	try {
		const parsed = JSON.parse(value) as {
			thinkingLevel?: unknown;
			visionModels?: unknown;
		};
		return {
			thinkingLevel: normalizePptThinkingLevel(parsed.thinkingLevel),
			visionModels: normalizePptVisionModels(parsed.visionModels),
		};
	} catch {
		return DEFAULT_PPT_MODEL_OPTIONS;
	}
}

export function pptModelOptionsToJson(options?: Partial<PptModelOptions>) {
	return JSON.stringify({
		thinkingLevel: normalizePptThinkingLevel(options?.thinkingLevel),
		visionModels: normalizePptVisionModels(options?.visionModels),
	});
}

export function normalizePptVisionModels(value: unknown) {
	if (!Array.isArray(value)) return [];
	return Array.from(
		new Set(
			value
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	).slice(0, 50);
}

export function isPptVisionModel(options: PptModelOptions, model: string) {
	return options.visionModels.includes(model);
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
