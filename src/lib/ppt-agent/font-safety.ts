const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
]);

const SYSTEM_FAMILIES = new Set([
	"system-ui",
	"-apple-system",
	"blinkmacsystemfont",
]);

const SAFE_FONT_FAMILIES = new Map(
	[
		"Microsoft YaHei",
		"SimHei",
		"SimSun",
		"KaiTi",
		"FangSong",
		"DengXian",
		"Microsoft JhengHei",
		"PingFang SC",
		"Heiti SC",
		"Songti SC",
		"STSong",
		"Arial",
		"Arial Black",
		"Calibri",
		"Segoe UI",
		"Verdana",
		"Helvetica",
		"Helvetica Neue",
		"Tahoma",
		"Trebuchet MS",
		"Times New Roman",
		"Times",
		"Georgia",
		"Cambria",
		"Palatino",
		"Garamond",
		"Book Antiqua",
		"Consolas",
		"Courier New",
		"Menlo",
		"Monaco",
		"Impact",
	].map((family) => [family.toLowerCase(), family]),
);

const FONT_ALIASES = new Map(
	Object.entries({
		"microsoft yahei ui": "Microsoft YaHei",
		"microsoft jhenghei ui": "Microsoft JhengHei",
		"aptos display": "Arial Black",
		aptos: "Arial",
		"noto sans cjk sc": "Microsoft YaHei",
		"noto sans sc": "Microsoft YaHei",
		"source han sans sc": "Microsoft YaHei",
		"harmonyos sans sc": "Microsoft YaHei",
		"noto serif cjk sc": "SimSun",
		"noto serif sc": "SimSun",
		"source han serif sc": "SimSun",
		stkaiti: "KaiTi",
		"kaiti sc": "KaiTi",
		stheiti: "SimHei",
		stfangsong: "FangSong",
		stxihei: "Microsoft YaHei",
		inter: "Arial",
		roboto: "Segoe UI",
		"sf pro": "Segoe UI",
		"sf pro display": "Segoe UI",
		"sf pro text": "Segoe UI",
	}),
);

const SERIF_FAMILIES = new Set([
	"SimSun",
	"KaiTi",
	"FangSong",
	"Songti SC",
	"STSong",
	"Times New Roman",
	"Times",
	"Georgia",
	"Cambria",
	"Palatino",
	"Garamond",
	"Book Antiqua",
]);

const MONO_FAMILIES = new Set([
	"Consolas",
	"Courier New",
	"Menlo",
	"Monaco",
]);

export function normalizePptFontStack(value: string) {
	const rawFamilies = splitFontStack(value);
	let generic = rawFamilies
		.map((family) => family.toLowerCase())
		.find((family) => GENERIC_FAMILIES.has(family));
	const normalized: string[] = [];
	let changed = false;

	for (const rawFamily of rawFamilies) {
		const lower = rawFamily.toLowerCase();
		if (GENERIC_FAMILIES.has(lower)) continue;
		if (SYSTEM_FAMILIES.has(lower)) {
			changed = true;
			continue;
		}
		const alias = FONT_ALIASES.get(lower);
		const family = alias || SAFE_FONT_FAMILIES.get(lower);
		if (alias || !family || family !== rawFamily) changed = true;
		if (family && !normalized.includes(family)) {
			normalized.push(family);
		} else if (family) {
			changed = true;
		}
	}

	if (!changed && normalized.length > 0) return value.trim();
	generic ||= inferGenericFamily(normalized);
	if (normalized.length === 0) {
		normalized.push(generic === "serif" ? "Georgia" : "Arial");
		normalized.push(generic === "serif" ? "SimSun" : "Microsoft YaHei");
	}

	return [
		...normalized.slice(0, 4),
		...(rawFamilies.some((family) =>
			GENERIC_FAMILIES.has(family.toLowerCase()),
		)
			? [generic]
			: []),
	]
		.map(formatFontFamily)
		.join(", ");
}

export function isPptFontSafetyWarning(message: string) {
	return /font stack exports non-ppt-safe typeface/i.test(message);
}

function splitFontStack(value: string) {
	const families: string[] = [];
	let current = "";
	let quote = "";

	for (const char of value) {
		if (quote) {
			if (char === quote) quote = "";
			else current += char;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === ",") {
			pushFamily(families, current);
			current = "";
			continue;
		}
		current += char;
	}
	pushFamily(families, current);
	return families;
}

function pushFamily(families: string[], value: string) {
	const family = value.trim();
	if (family) families.push(family);
}

function inferGenericFamily(families: string[]) {
	if (families.some((family) => MONO_FAMILIES.has(family))) return "monospace";
	if (families.some((family) => SERIF_FAMILIES.has(family))) return "serif";
	return "sans-serif";
}

function formatFontFamily(family: string) {
	return family.includes(" ") ? `"${family}"` : family;
}
