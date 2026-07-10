export const PPT_IMAGE_MODEL_NONE = "none";

export function getPptImageCountLimit(slideCount: number) {
	const normalized = Number.isFinite(slideCount) ? Math.round(slideCount) : 10;
	return Math.min(8, Math.max(2, Math.ceil(normalized / 3)));
}

export function getPptImageUnitCreditCost(input: {
	source: "user" | "platform";
	creditCost?: number | null;
	fallbackCost: number;
}) {
	if (input.source === "user") return 0;
	return Math.max(0, Math.round(input.creditCost ?? input.fallbackCost));
}

export function isPptImageGenerationEnabled(input: {
	workflow: "svg" | "template-fill";
	imageModel?: string;
	imageModelSource?: "user" | "platform";
	imageCountLimit?: number;
}) {
	return Boolean(
		input.workflow === "svg" &&
			input.imageModel &&
			input.imageModelSource &&
			(input.imageCountLimit || 0) > 0,
	);
}
