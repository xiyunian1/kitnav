import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Runner 间共享的小工具，消除 3 个 runner（configured/agent/hosted）各自复制一份的样板。
 */

/**
 * 在项目的 exports/ 目录下找出最新的 PPTX 文件（排除中间产物 _svg.pptx）。
 * 多个 runner 在 PPTX 导出后用同一逻辑兜底查找最终产物，原各自重复一份。
 */
export function findLatestPptx(projectDir: string): string {
	const exportsDir = join(projectDir, "exports");
	if (!existsSync(exportsDir)) return "";
	const files = readdirSync(exportsDir)
		.filter(
			(file) =>
				file.toLowerCase().endsWith(".pptx") &&
				!file.toLowerCase().endsWith("_svg.pptx"),
		)
		.map((file) => join(exportsDir, file))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
	return files[0] || "";
}
