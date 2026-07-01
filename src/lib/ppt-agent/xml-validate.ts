import { SaxesParser } from "saxes";

/**
 * 用纯 JS（saxes）校验 SVG 字符串的 XML 良构性。
 *
 * 此前实现用 `execFileSync("python3", ...)` 同步 fork 一个 Python 解释器来跑
 * `xml.etree.ElementTree.fromstring`。该函数被 SVG 每页每次校验调用（最多
 * N 页 × 4 次重试），同步 fork 进程会阻塞整个 Node 事件循环，是生成流程的
 * 单点最大性能瓶颈。这里换成纯 JS SAX 解析，零进程开销，保持同样的契约：
 *   - 合法 XML 返回空串；
 *   - 非法 XML 返回一行精简错误（行/列/原因），不超过 240 字符。
 */
export function findXmlWellFormednessError(svg: string): string {
	const parser = new SaxesParser({ xmlns: true, position: true });
	let firstError: string | null = null;

	parser.on(
		"error",
		(error: { message: string; line?: number; column?: number }) => {
			// saxes 在遇到致命错误后仍可能继续报告；只取第一条，保持与原 Python 实现一致的「首个错误」语义。
			if (firstError === null) {
				const where =
					error.line !== undefined && error.column !== undefined
						? ` (line ${error.line}, col ${error.column})`
						: "";
				firstError = `${error.message}${where}`;
			}
		},
	);

	// saxes 的事件回调在 write/close 期间同步触发，因此整段调用保持同步。
	try {
		parser.write(svg);
		parser.close();
	} catch (error) {
		// saxes 默认通过 error 事件而非抛出，但兜底防御非预期抛出。
		const message = error instanceof Error ? error.message : String(error);
		firstError = firstError ?? message;
	}

	if (!firstError) return "";
	return firstError.replace(/\s+/g, " ").trim().slice(0, 240);
}
