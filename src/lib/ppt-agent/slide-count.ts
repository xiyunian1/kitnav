export function clampSlideCount(value: number) {
	if (!Number.isFinite(value)) return 10;
	return Math.max(3, Math.min(30, Math.round(value)));
}
