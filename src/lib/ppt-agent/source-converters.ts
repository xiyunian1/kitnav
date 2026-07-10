import { existsSync, readFileSync } from "fs";
import { mkdir } from "fs/promises";
import { dirname, extname, resolve } from "path";
import { spawn } from "child_process";
import { isIP } from "net";
import { promises as dns } from "dns";
import { getPptMasterSkillDir } from "./runtime-paths";
import { getPptPythonCommand } from "./python-tools";
import {
	assertInsideUploadRoot,
	getPptUploadRoot,
	resolveUploadPath,
} from "./upload-paths";

const DOCUMENT_CONVERTERS: Record<
	string,
	{ script: string[]; extraArgs?: string[] }
> = {
	".pdf": { script: ["source_to_md", "pdf_to_md.py"] },
	".docx": { script: ["source_to_md", "doc_to_md.py"] },
	".html": { script: ["source_to_md", "doc_to_md.py"] },
	".htm": { script: ["source_to_md", "doc_to_md.py"] },
	".epub": { script: ["source_to_md", "doc_to_md.py"] },
	".ipynb": { script: ["source_to_md", "doc_to_md.py"] },
	".pptx": { script: ["source_to_md", "ppt_to_md.py"] },
	".pptm": { script: ["source_to_md", "ppt_to_md.py"] },
	".ppsx": { script: ["source_to_md", "ppt_to_md.py"] },
	".ppsm": { script: ["source_to_md", "ppt_to_md.py"] },
	".potx": { script: ["source_to_md", "ppt_to_md.py"] },
	".potm": { script: ["source_to_md", "ppt_to_md.py"] },
	".xlsx": { script: ["source_to_md", "excel_to_md.py"] },
	".xlsm": { script: ["source_to_md", "excel_to_md.py"] },
};

export { getPptUploadRoot, resolveUploadPath };

export async function convertDocumentToMarkdown(
	inputPath: string,
	outputPath: string,
) {
	const resolvedInput = resolve(inputPath);
	assertInsideUploadRoot(resolvedInput);
	if (!existsSync(resolvedInput))
		throw new Error("上传文档不存在，请重新上传。");

	const ext = extname(resolvedInput).toLowerCase();
	const converter = DOCUMENT_CONVERTERS[ext];
	if (!converter) throw new Error("不支持的 PPT 文档格式。");

	await mkdir(dirname(outputPath), { recursive: true });
	const scriptPath = resolve(
		getPptMasterSkillDir(),
		"scripts",
		...converter.script,
	);
	await executePython(scriptPath, [resolvedInput, "-o", outputPath], 300_000);
	return readConvertedMarkdown(outputPath);
}

export async function convertUrlToMarkdownFile(
	url: string,
	outputPath: string,
) {
	await assertSafePublicUrl(url);
	await mkdir(dirname(outputPath), { recursive: true });
	const scriptPath = resolve(
		getPptMasterSkillDir(),
		"scripts",
		"source_to_md",
		"web_to_md.py",
	);
	await executePython(scriptPath, [url, "-o", outputPath], 180_000);
	return readConvertedMarkdown(outputPath);
}

export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("网页 URL 格式不正确。");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("网页 URL 只支持 http 或 https。");
	}
	const host = url.hostname.toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost")) {
		throw new Error("不支持抓取本机地址。");
	}
	const addresses = await resolveAllAddresses(host);
	for (const address of addresses) {
		if (isPrivateAddress(address)) {
			throw new Error("不支持抓取内网地址。");
		}
	}
}

async function resolveAllAddresses(host: string): Promise<string[]> {
	// 字面量 IP（含 IPv4-mapped IPv6）直接判定，不走 DNS。
	if (isIP(host)) return [host];
	try {
		const records = await dns.lookup(host, { all: true, verbatim: true });
		if (records.length === 0) throw new Error("无法解析网页域名。");
		return records.map((record) => record.address);
	} catch {
		throw new Error("无法解析网页域名。");
	}
}

/** 判定一个 IP 地址是否落在私有/本机/保留范围。覆盖 IPv4 与 IPv6（含 IPv4-mapped）。 */
function isPrivateAddress(address: string): boolean {
	// IPv4-mapped IPv6（::ffff:a.b.c.d）与 IPv4-compatible（::a.b.c.d）：拆出内嵌 IPv4 判定。
	const mapped = address.match(
		/^::(?:ffff:(?:0+:)?)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i,
	);
	if (mapped) return isPrivateAddress(mapped[1]);

	const family = isIP(address);
	if (family === 4) {
		const parts = address.split(".").map(Number);
		const [a, b] = parts;
		return (
			a === 0 || // 0.0.0.0/8
			a === 10 || // 10.0.0.0/8
			a === 127 || // 127.0.0.0/8
			(a === 169 && b === 254) || // 169.254.0.0/16 link-local
			(a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
			(a === 192 && b === 0 && parts[2] === 2) || // 192.0.2.0/24 TEST-NET-1
			(a === 192 && b === 168) || // 192.168.0.0/16
			(a === 198 && (b === 51 || b === 18)) || // 198.18.0.0/15 测试
			(a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 CGNAT
		);
	}
	if (family === 6) {
		const lower = address.toLowerCase();
		return (
			lower === "::1" || // 回环
			lower === "::" || // 未指定
			lower.startsWith("fc") || // fc00::/7 ULA（含 fc/fd）
			lower.startsWith("fd") ||
			lower.startsWith("fe8") || // fe80::/10 link-local（fe8/fe9/fea/feb）
			lower.startsWith("fe9") ||
			lower.startsWith("fea") ||
			lower.startsWith("feb") ||
			lower.startsWith("64:ff9b:") || // 64:ff9b::/96 NAT64
			lower.startsWith("100::") || // 100::/64 discard
			lower.startsWith("2001:db8:") // 2001:db8::/32 文档
		);
	}
	return false;
}

function readConvertedMarkdown(outputPath: string) {
	const text = readFileSync(outputPath, "utf-8").trim();
	if (!text) throw new Error("文档转换后没有可用内容。");
	return text;
}

async function executePython(
	scriptPath: string,
	args: string[],
	timeoutMs: number,
) {
	return new Promise<void>((resolvePromise, reject) => {
		const proc = spawn(getPptPythonCommand(), [scriptPath, ...args], {
			cwd: getPptMasterSkillDir(),
			windowsHide: true,
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error(`文档转换超时：${scriptPath}`));
		}, timeoutMs);
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf-8");
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf-8");
		});
		proc.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		proc.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) {
				resolvePromise();
				return;
			}
			reject(new Error(`文档转换失败：${(stderr || stdout).slice(0, 4000)}`));
		});
	});
}
