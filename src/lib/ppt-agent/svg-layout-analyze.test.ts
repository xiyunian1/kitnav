import { describe, expect, it } from "vitest";
import { findSvgTextLayoutIssues } from "./svg-layout-analyze";

/**
 * SVG 文字布局重叠检测回归测试。
 * 守护 #13 的 saxes AST 重写：嵌套 transform、tspan 多行、重叠检出/不误报。
 */

function svg(inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">${inner}</svg>`;
}

describe("findSvgTextLayoutIssues", () => {
	it("间距充足的多段文字不应报告重叠", () => {
		const s = svg(`
      <text x="100" y="100" font-size="40">左侧标题</text>
      <text x="500" y="100" font-size="40">右侧标题</text>
    `);
		expect(findSvgTextLayoutIssues(s)).toEqual([]);
	});

	it("同一基线上 x 重叠的长中文标题应被检出", () => {
		const s = svg(`
      <text x="100" y="100" font-size="40">这是一段较长的中文标题文字内容</text>
      <text x="120" y="102" font-size="40">另一段重叠的中文标题文字内容</text>
    `);
		const issues = findSvgTextLayoutIssues(s);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues[0]).toContain("可能重叠");
	});

	it("嵌套 <g transform> 下的文字定位应正确解析，不误报", () => {
		// 两段文字经不同 transform 后落在相距很远的位置，不应判为重叠。
		const s = svg(`
      <g transform="translate(100,100)">
        <text x="0" y="0" font-size="30">第一组文字</text>
      </g>
      <g transform="translate(500,400)">
        <text x="0" y="0" font-size="30">第二组文字</text>
      </g>
    `);
		expect(findSvgTextLayoutIssues(s)).toEqual([]);
	});

	it("多层嵌套 transform 应正确累加偏移", () => {
		// 文字经三层 translate 累加到 (300,200)，与同位置文字重叠应被检出。
		const s = svg(`
      <g transform="translate(100,50)">
        <g transform="translate(100,100)">
          <g transform="translate(100,50)">
            <text x="0" y="0" font-size="30">深层重叠文字一</text>
          </g>
        </g>
      </g>
      <text x="300" y="200" font-size="30">深层重叠文字二</text>
    `);
		expect(findSvgTextLayoutIssues(s).length).toBeGreaterThan(0);
	});

	it("带定位 tspan 的多行文字不应互相误报重叠", () => {
		const s = svg(`
      <text x="100" y="100" font-size="28">
        <tspan x="100" y="100">第一行要点内容</tspan>
        <tspan x="100" y="140">第二行要点内容</tspan>
        <tspan x="100" y="180">第三行要点内容</tspan>
      </text>
    `);
		expect(findSvgTextLayoutIssues(s)).toEqual([]);
	});

	it("text-anchor=middle / end 的水平位置应正确", () => {
		// middle 锚点：文字以 x 为中心，右侧 start 锚点文字与之重叠应检出。
		const s = svg(`
      <text x="200" y="100" font-size="32" text-anchor="middle">居中的中文标题文字</text>
      <text x="180" y="100" font-size="32">起始锚点标题文字</text>
    `);
		expect(findSvgTextLayoutIssues(s).length).toBeGreaterThan(0);
	});

	it("过短文字（<2 字符）不参与检测", () => {
		const s = svg(`
      <text x="100" y="100" font-size="20">A</text>
      <text x="100" y="100" font-size="20">B</text>
    `);
		expect(findSvgTextLayoutIssues(s)).toEqual([]);
	});

	it("最多返回 5 条问题", () => {
		// 6 对重叠文字，应截断为 5 条。
		const lines: string[] = [];
		for (let i = 0; i < 7; i++) {
			lines.push(`<text x="100" y="100" font-size="30">重叠文字${i}号</text>`);
		}
		const s = svg(lines.join(""));
		expect(findSvgTextLayoutIssues(s).length).toBe(5);
	});

	it("解析失败时静默返回，不抛异常", () => {
		// saxes 对严重畸形输入会抛错，应被吞掉。
		expect(findSvgTextLayoutIssues("<<<not svg>>")).toEqual([]);
	});
});
