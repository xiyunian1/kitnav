import { describe, expect, it } from "vitest";
import { findXmlWellFormednessError } from "./xml-validate";

/**
 * XML 良构校验回归测试（守护 #2：saxes 取代同步 execFileSync(python)）。
 *
 * 实际契约：合法 XML 返回空串；非法 XML 返回一行精简错误。
 */

describe("findXmlWellFormednessError", () => {
	it("良构的简单 XML 返回空串（无错误）", () => {
		expect(findXmlWellFormednessError("<root><a>1</a><b>2</b></root>")).toBe(
			"",
		);
	});

	it("良构的 SVG（含命名空间与属性）返回空串", () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="20">hi</text></svg>';
		expect(findXmlWellFormednessError(svg)).toBe("");
	});

	it("未闭合标签应返回错误信息", () => {
		const err = findXmlWellFormednessError("<root><a>1</root>");
		expect(err).not.toBe("");
		expect(typeof err).toBe("string");
	});

	it("标签不匹配应返回错误信息", () => {
		const err = findXmlWellFormednessError("<root></a>");
		expect(err).not.toBe("");
	});

	it("空字符串视为错误（缺少根元素）", () => {
		const err = findXmlWellFormednessError("");
		expect(err).not.toBe("");
		expect(err.toLowerCase()).toContain("root");
	});

	it("自闭合标签与 CDATA 应被正确接受", () => {
		expect(
			findXmlWellFormednessError("<root><a/><b><![CDATA[x<y>z]]></b></root>"),
		).toBe("");
	});
});
