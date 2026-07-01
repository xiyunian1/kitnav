import { SaxesParser, type SaxesStartTag } from "saxes";

/**
 * SVG 文字布局分析：检测文字框之间的「拥挤重叠」。
 *
 * 取代此前用正则解析 <text>/<tspan>/<g transform> 的脆弱写法。这里用 saxes 这类
 * 真正的 XML SAX 解析器维护一个 transform 栈，按文档顺序精确累积祖先 <g> 的
 * translate/matrix 偏移，从而正确处理任意嵌套变换下的文字定位——模型生成的复杂 SVG
 * 里常见的多层 <g transform> 场景，正则版容易算错坐标。
 *
 * 宽度/高度/重叠判定仍沿用已验证的启发式（estimateTextWidth 等），因为精确几何需要
 * 真正的 SVG 渲染器（headless 浏览器），不值得为该质量门引入。
 */

export interface SvgTextBox {
	x: number;
	y: number;
	width: number;
	height: number;
	text: string;
}

export function findSvgTextLayoutIssues(svg: string): string[] {
	const boxes = extractSvgTextBoxes(svg);
	const issues: string[] = [];
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			if (!isLikelyBadOverlap(boxes[i], boxes[j])) continue;
			issues.push(
				`"${boxes[i].text.slice(0, 12)}" 与 "${boxes[j].text.slice(0, 12)}" 可能重叠`,
			);
			if (issues.length >= 5) return issues;
		}
	}
	return issues;
}

function extractSvgTextBoxes(svg: string): SvgTextBox[] {
	const parser = new SaxesParser({ xmlns: false, position: false });
	const boxes: SvgTextBox[] = [];

	// transform 栈：每个 <g> 开标签压入其 translate/matrix 偏移增量，闭标签弹出。
	const offsetStack: Array<{ x: number; y: number }> = [];
	const acc = () =>
		offsetStack.reduce((s, o) => ({ x: s.x + o.x, y: s.y + o.y }), {
			x: 0,
			y: 0,
		});

	interface TextFrame {
		kind: "text";
		baseX: number | null;
		baseY: number | null;
		fontSize: number;
		anchor: string;
		offset: { x: number; y: number };
		curX: number;
		curY: number;
		text: string; // 直接位于 <text> 下的文字
		anyPositionedTspan: boolean;
		childBoxes: number; // tspan 产生的 box 数
	}
	interface TspanFrame {
		kind: "tspan";
		parent: TextFrame;
		fontSize: number;
		anchor: string;
		curX: number;
		curY: number;
		text: string;
		positioned: boolean;
	}
	const frameStack: Array<TextFrame | TspanFrame> = [];

	parser.on("opentag", (node: SaxesStartTag) => {
		const name = node.name.toLowerCase();
		// xmlns:false 下属性运行期为纯字符串，但 saxes 类型含 SaxesAttributeNS 联合，这里统一转为 string。
		const attrs = node.attributes as unknown as Record<string, string>;
		if (name === "g") {
			offsetStack.push(transformDelta(attrs.transform));
			return;
		}
		if (name === "text") {
			// off = 祖先 <g> 累积偏移（acc()）+ 本 text 元素自身的 transform 属性，两者相加。
			// 注意不能用对象展开合并：transformDelta 无 transform 时返回 {0,0} 会覆盖 acc()。
			const ancestor = acc();
			const ownTransform = transformDelta(attrs.transform);
			const off = {
				x: ancestor.x + ownTransform.x,
				y: ancestor.y + ownTransform.y,
			};
			const fontSize = numAttr(attrs, "font-size") ?? 16;
			const x = numAttr(attrs, "x");
			const y = numAttr(attrs, "y");
			frameStack.push({
				kind: "text",
				baseX: x,
				baseY: y,
				fontSize,
				anchor: attrs["text-anchor"] || "start",
				offset: off,
				curX: x === null ? 0 : x + off.x,
				curY: y === null ? 0 : y + off.y,
				text: "",
				anyPositionedTspan: false,
				childBoxes: 0,
			});
			return;
		}
		if (name === "tspan") {
			const top = frameStack[frameStack.length - 1];
			if (!top || top.kind !== "text") return; // tspan 必须在 text 内
			const tx = numAttr(attrs, "x");
			const ty = numAttr(attrs, "y");
			const dy = numAttr(attrs, "dy");
			const positioned = tx !== null || ty !== null || dy !== null;
			if (positioned) top.anyPositionedTspan = true;
			let curX = top.curX;
			let curY = top.curY;
			if (tx !== null) curX = tx + top.offset.x;
			if (ty !== null) curY = ty + top.offset.y;
			if (dy !== null) curY += dy;
			const tOff = transformDelta(attrs.transform);
			frameStack.push({
				kind: "tspan",
				parent: top,
				fontSize: numAttr(attrs, "font-size") ?? top.fontSize,
				anchor: attrs["text-anchor"] || top.anchor,
				curX: curX + tOff.x,
				curY: curY + tOff.y,
				text: "",
				positioned,
			});
		}
	});

	parser.on("text", (t: string) => {
		const top = frameStack[frameStack.length - 1];
		if (top) top.text += t;
	});

	parser.on("closetag", (node: SaxesStartTag) => {
		const name = node.name.toLowerCase();
		if (name === "g") {
			offsetStack.pop();
			return;
		}
		const top = frameStack.pop();
		if (!top) return;
		if (top.kind === "tspan") {
			const text = normalizeText(top.text);
			// 仅在父 text 存在定位 tspan 时，才把每个 tspan 当独立 box（与正则版语义一致）。
			if (text && top.parent.anyPositionedTspan) {
				pushBox(boxes, top.curX, top.curY, text, top.fontSize, top.anchor);
				top.parent.childBoxes++;
			} else if (text) {
				// 无定位 tspan：累加到父 text 的文字，由父 text 闭合时统一成单 box。
				top.parent.text += text;
			}
			return;
		}
		if (top.kind === "text") {
			const text = normalizeText(top.text);
			const hasBox = top.childBoxes > 0;
			// 有定位 tspan 时不另出整段 box；否则整段文字成一个 box。
			if (!hasBox && text && top.baseX !== null && top.baseY !== null) {
				pushBox(boxes, top.curX, top.curY, text, top.fontSize, top.anchor);
			}
		}
	});

	try {
		parser.write(svg);
		parser.close();
	} catch {
		// 解析错误时静默：layout 校验本就是尽力而为，XML 合法性由 xml-validate 负责。
	}

	return boxes.filter((b) => b.text.length >= 2);
}

function pushBox(
	boxes: SvgTextBox[],
	x: number,
	baselineY: number,
	value: string,
	fontSize: number,
	anchor: string,
) {
	boxes.push(estimateTextBox(x, baselineY, value, fontSize, anchor));
}

function normalizeText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function numAttr(attrs: Record<string, string>, name: string): number | null {
	const raw = attrs[name];
	if (raw === undefined) return null;
	const n = Number(raw);
	return Number.isFinite(n) ? n : null;
}

/** 解析 transform 中的 translate() 与 matrix() 的位移分量。 */
function transformDelta(transform: string | undefined): {
	x: number;
	y: number;
} {
	let x = 0;
	let y = 0;
	if (transform) {
		for (const m of transform.matchAll(
			/translate\(\s*(-?\d+(?:\.\d+)?)(?:[\s,]+(-?\d+(?:\.\d+)?))?\s*\)/gi,
		)) {
			x += Number(m[1]);
			y += m[2] !== undefined ? Number(m[2]) : 0;
		}
		const matrix = transform.match(
			/matrix\(\s*-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?[\s,]+-?\d+(?:\.\d+)?[\s,]+(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/i,
		);
		if (matrix) {
			x += Number(matrix[1]);
			y += Number(matrix[2]);
		}
	}
	return { x, y };
}

function estimateTextBox(
	x: number,
	baselineY: number,
	value: string,
	fontSize: number,
	anchor: string,
): SvgTextBox {
	const width = estimateTextWidth(value, fontSize);
	const height = fontSize * 1.18;
	const left =
		anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
	return {
		x: left,
		y: baselineY - fontSize * 0.86,
		width,
		height,
		text: value,
	};
}

function estimateTextWidth(value: string, fontSize: number): number {
	let units = 0;
	for (const char of value) {
		if (/[\u4e00-\u9fff]/.test(char)) units += 1;
		else if (/[A-Z0-9]/.test(char)) units += 0.68;
		else if (/[a-z]/.test(char)) units += 0.56;
		else if (/\s/.test(char)) units += 0.35;
		else units += 0.5;
	}
	return units * fontSize;
}

function isLikelyBadOverlap(a: SvgTextBox, b: SvgTextBox): boolean {
	const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const overlapY =
		Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	if (overlapX <= 0 || overlapY <= 0) return false;
	const minArea = Math.min(a.width * a.height, b.width * b.height);
	if ((overlapX * overlapY) / Math.max(minArea, 1) < 0.18) return false;
	const baselineDistance = Math.abs(
		a.y + a.height * 0.72 - (b.y + b.height * 0.72),
	);
	return baselineDistance < Math.max(a.height, b.height) * 0.72;
}
