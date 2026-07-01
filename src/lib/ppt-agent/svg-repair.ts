/**
 * SVG 字符串修复与清洗工具集。
 *
 * 从 orchestrator.ts 拆分（#12）：这些都是对模型生成 SVG 文本的纯字符串变换——
 * 语法修复、实体转义、页码剥离、空组清理、乱码检测等，无任何 orchestrator 内部状态依赖。
 */

/** SVG 校验/处理类错误，携带错误种类供上层区分重试策略。 */
export class SvgValidationError extends Error {
	constructor(
		message: string,
		readonly kind: "invalid" | "mojibake" | "layout" | "xml",
	) {
		super(message);
		this.name = "SvgValidationError";
	}
}

/** 从模型输出中抽取首个 <svg>…</svg> 片段。 */
export function extractSvg(text: string): string {
	const match = text.match(/<svg[\s\S]*?<\/svg>/i);
	if (!match)
		throw new SvgValidationError("PPT 模型没有返回有效 SVG。", "invalid");
	return match[0];
}

/** 修复模型生成的「属性粘连」SVG（标签后直接跟属性，如 <textx=>）。 */
export function normalizeGeneratedSvg(svg: string): string {
	return sanitizeUnsupportedSvgFeatures(
		escapeRawAmpersands(repairCompressedSvgSyntax(svg)),
	);
}

function repairCompressedSvgSyntax(svg: string): string {
	const tagNames = [
		"svg",
		"g",
		"defs",
		"linearGradient",
		"radialGradient",
		"stop",
		"filter",
		"feGaussianBlur",
		"feOffset",
		"feFlood",
		"feComposite",
		"feMerge",
		"feMergeNode",
		"marker",
		"path",
		"rect",
		"circle",
		"ellipse",
		"line",
		"polyline",
		"polygon",
		"text",
		"tspan",
		"image",
		"use",
		"clipPath",
		"mask",
	];
	const tagPattern = new RegExp(
		`<(${tagNames.map(escapeRegExp).join("|")})(?=[A-Za-z_:][-A-Za-z0-9_:.]*=)`,
		"g",
	);
	return svg
		.replace(tagPattern, "<$1 ")
		.replace(/"(?=[A-Za-z_:][-A-Za-z0-9_:.]*=)/g, '" ')
		.replace(/'(?=[A-Za-z_:][-A-Za-z0-9_:.]*=)/g, "' ");
}

function escapeRawAmpersands(svg: string): string {
	return svg.replace(
		/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g,
		"&amp;",
	);
}

/** 移除 PPT 渲染管线不支持的 CSS filter（drop-shadow）与 <g> 上的 opacity。 */
function sanitizeUnsupportedSvgFeatures(svg: string): string {
	return svg
		.replace(/\sfilter=["']drop-shadow\([^"']*\)["']/gi, "")
		.replace(/<g\b([^>]*)\sopacity=["'][^"']+["']([^>]*)>/gi, "<g$1$2>");
}

/** 剥离自动生成的页码文字，并清理随之出现的空 <g>（保留带 footer/page id 的组）。 */
export function stripSlidePageNumbers(svg: string): string {
	return stripEmptyGroups(
		svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/gi, (node) => {
			const text = cleanSvgText(node);
			return isSlidePageNumberText(text) ? "" : node;
		}),
	);
}

function stripEmptyGroups(svg: string): string {
	let current = svg;
	for (let i = 0; i < 4; i++) {
		const next = current.replace(/<g\b([^>]*)>\s*<\/g>/gi, (node, attrs) =>
			/\bid=["'][^"']*(?:page|pagenum|page-number|footer)[^"']*["']/i.test(
				attrs,
			)
				? ""
				: node,
		);
		if (next === current) return current;
		current = next;
	}
	return current;
}

function isSlidePageNumberText(text: string): boolean {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return false;
	return (
		/^第\s*[一二三四五六七八九十百\d０-９]+\s*页\s*(?:\/|／|，共|共)?\s*(?:共\s*)?[一二三四五六七八九十百\d０-９]*\s*页?$/.test(
			normalized,
		) ||
		/^(?:PAGE|SLIDE)\s*\d+\s*(?:\/|OF)\s*\d+$/i.test(normalized) ||
		/^\d{1,2}\s*(?:\/|／)\s*\d{1,2}$/.test(normalized) ||
		/^\d{2}\s*(?:\/|／)\s*\d{2}$/.test(normalized)
	);
}

/** 判断 SVG 是否具备可被后续渲染管线处理的最小结构。 */
export function looksLikeRunnableSvg(svg: string): boolean {
	return (
		/^<svg[\s>]/i.test(svg.trim()) &&
		/\sxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svg) &&
		/\sviewBox=["'][^"']+["']/i.test(svg) &&
		!/<foreignObject\b/i.test(svg)
	);
}

/** 检测中文乱码（mojibake）：当乱码字符占比过高时判定为损坏输出。 */
export function hasBrokenChineseText(svg: string): boolean {
	const text = stripSvgMarkup(svg);
	if (!text.trim()) return true;
	const mojibakeMatches =
		text.match(/[锛銆绗浣佹湁妯涓鍙鐢诲湪瀛]/g)?.length ?? 0;
	const chineseMatches = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
	return (
		chineseMatches > 12 && mojibakeMatches / Math.max(chineseMatches, 1) > 0.35
	);
}

function cleanSvgText(value: string): string {
	return value
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function stripSvgMarkup(svg: string): string {
	return svg
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
