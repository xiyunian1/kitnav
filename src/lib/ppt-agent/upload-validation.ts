const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_COMPRESSION_RATIO = 200;

export const PPT_UPLOAD_EXTENSIONS = new Set([
	".pdf",
	".docx",
	".html",
	".htm",
	".epub",
	".ipynb",
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
	".xlsx",
	".xlsm",
]);

const PPT_EXTENSIONS = new Set([
	".pptx",
	".pptm",
	".ppsx",
	".ppsm",
	".potx",
	".potm",
]);
const EXCEL_EXTENSIONS = new Set([".xlsx", ".xlsm"]);

export function assertValidPptUpload(buffer: Buffer, extension: string) {
	const ext = extension.toLowerCase();
	if (!PPT_UPLOAD_EXTENSIONS.has(ext)) {
		throw new Error("不支持的文档格式。");
	}
	if (buffer.length === 0) throw new Error("上传文档为空。");

	if (ext === ".pdf") {
		assertPdf(buffer);
		return;
	}
	if (ext === ".html" || ext === ".htm") {
		assertHtml(buffer);
		return;
	}
	if (ext === ".ipynb") {
		assertNotebook(buffer);
		return;
	}

	const entries = readZipEntries(buffer);
	if (ext === ".docx") {
		assertZipEntries(entries, ["[Content_Types].xml", "word/document.xml"]);
		return;
	}
	if (PPT_EXTENSIONS.has(ext)) {
		assertZipEntries(entries, ["[Content_Types].xml", "ppt/presentation.xml"]);
		return;
	}
	if (EXCEL_EXTENSIONS.has(ext)) {
		assertZipEntries(entries, ["[Content_Types].xml", "xl/workbook.xml"]);
		return;
	}
	if (ext === ".epub") {
		assertZipEntries(entries, ["mimetype", "META-INF/container.xml"]);
	}
}

function invalidFile(): never {
	throw new Error("文件内容与扩展名不匹配，或文件已损坏。");
}

function assertPdf(buffer: Buffer) {
	const headerEnd = Math.min(buffer.length, 1024);
	if (buffer.subarray(0, headerEnd).indexOf(Buffer.from("%PDF-")) < 0) {
		invalidFile();
	}
}

function assertHtml(buffer: Buffer) {
	if (buffer.includes(0)) invalidFile();
	const sample = buffer.subarray(0, Math.min(buffer.length, 1024 * 1024));
	const text = sample.toString("latin1").toLowerCase();
	if (!/<(?:!doctype\s+html|html|head|body)(?:\s|>)/.test(text)) {
		invalidFile();
	}
}

function assertNotebook(buffer: Buffer) {
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
		const notebook = JSON.parse(text) as {
			cells?: unknown;
			nbformat?: unknown;
		};
		if (!Array.isArray(notebook.cells) || !Number.isInteger(notebook.nbformat)) {
			invalidFile();
		}
	} catch {
		invalidFile();
	}
}

function assertZipEntries(entries: Set<string>, required: string[]) {
	if (!required.every((entry) => entries.has(entry))) invalidFile();
}

function readZipEntries(buffer: Buffer) {
	const eocdOffset = findEndOfCentralDirectory(buffer);
	if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) invalidFile();

	const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
	const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
	const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
	const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
	const centralSize = buffer.readUInt32LE(eocdOffset + 12);
	const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
	const commentLength = buffer.readUInt16LE(eocdOffset + 20);

	if (
		diskNumber !== 0 ||
		centralDisk !== 0 ||
		diskEntries !== totalEntries ||
		totalEntries === 0 ||
		totalEntries === 0xffff ||
		totalEntries > MAX_ZIP_ENTRIES ||
		centralSize === 0xffffffff ||
		centralOffset === 0xffffffff ||
		eocdOffset + 22 + commentLength !== buffer.length ||
		centralOffset + centralSize > eocdOffset
	) {
		invalidFile();
	}

	const entries = new Set<string>();
	let cursor = centralOffset;
	let totalUncompressedBytes = 0;
	for (let index = 0; index < totalEntries; index += 1) {
		if (cursor + 46 > eocdOffset || buffer.readUInt32LE(cursor) !== 0x02014b50) {
			invalidFile();
		}
		const flags = buffer.readUInt16LE(cursor + 8);
		const compressionMethod = buffer.readUInt16LE(cursor + 10);
		const compressedBytes = buffer.readUInt32LE(cursor + 20);
		const uncompressedBytes = buffer.readUInt32LE(cursor + 24);
		const nameLength = buffer.readUInt16LE(cursor + 28);
		const extraLength = buffer.readUInt16LE(cursor + 30);
		const entryCommentLength = buffer.readUInt16LE(cursor + 32);
		const entryEnd =
			cursor + 46 + nameLength + extraLength + entryCommentLength;
		if (
			entryEnd > eocdOffset ||
			(flags & 0x1) !== 0 ||
			(compressionMethod !== 0 && compressionMethod !== 8) ||
			compressedBytes === 0xffffffff ||
			uncompressedBytes === 0xffffffff ||
			uncompressedBytes > MAX_ZIP_ENTRY_BYTES ||
			(uncompressedBytes > 0 && compressedBytes === 0) ||
			uncompressedBytes / Math.max(1, compressedBytes) >
				MAX_ZIP_COMPRESSION_RATIO
		) {
			invalidFile();
		}

		const name = buffer
			.subarray(cursor + 46, cursor + 46 + nameLength)
			.toString((flags & 0x800) !== 0 ? "utf8" : "latin1");
		if (
			!name ||
			name.includes("\\") ||
			name.startsWith("/") ||
			name.split("/").includes("..")
		) {
			invalidFile();
		}
		entries.add(name);
		totalUncompressedBytes += uncompressedBytes;
		if (totalUncompressedBytes > MAX_ZIP_TOTAL_BYTES) invalidFile();
		cursor = entryEnd;
	}

	if (cursor !== centralOffset + centralSize) invalidFile();
	return entries;
}

function findEndOfCentralDirectory(buffer: Buffer) {
	const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
	for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
	}
	return -1;
}
