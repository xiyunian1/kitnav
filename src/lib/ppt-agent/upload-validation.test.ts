import { describe, expect, it } from "vitest";
import { assertValidPptUpload } from "./upload-validation";

describe("PPT upload validation", () => {
	it("accepts files whose contents match their declared format", () => {
		expect(() =>
			assertValidPptUpload(Buffer.from("%PDF-1.7\n%%EOF"), ".pdf"),
		).not.toThrow();
		expect(() =>
			assertValidPptUpload(
				Buffer.from(JSON.stringify({ cells: [], nbformat: 4 })),
				".ipynb",
			),
		).not.toThrow();
		expect(() =>
			assertValidPptUpload(
				makeStoredZip(["[Content_Types].xml", "ppt/presentation.xml"]),
				".pptx",
			),
		).not.toThrow();
	});

	it("rejects extension spoofing and malformed archives", () => {
		expect(() => assertValidPptUpload(Buffer.from("not a pdf"), ".pdf")).toThrow(
			"扩展名不匹配",
		);
		expect(() =>
			assertValidPptUpload(
				makeStoredZip(["[Content_Types].xml", "word/document.xml"]),
				".pptx",
			),
		).toThrow("扩展名不匹配");
		expect(() =>
			assertValidPptUpload(
				makeStoredZip(["[Content_Types].xml", "ppt/../payload"]),
				".pptx",
			),
		).toThrow("扩展名不匹配");
	});
});

function makeStoredZip(names: string[]) {
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let localOffset = 0;

	for (const name of names) {
		const encodedName = Buffer.from(name, "utf8");
		const local = Buffer.alloc(30 + encodedName.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(encodedName.length, 26);
		encodedName.copy(local, 30);
		localParts.push(local);

		const central = Buffer.alloc(46 + encodedName.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(encodedName.length, 28);
		central.writeUInt32LE(localOffset, 42);
		encodedName.copy(central, 46);
		centralParts.push(central);
		localOffset += local.length;
	}

	const centralDirectory = Buffer.concat(centralParts);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(names.length, 8);
	eocd.writeUInt16LE(names.length, 10);
	eocd.writeUInt32LE(centralDirectory.length, 12);
	eocd.writeUInt32LE(localOffset, 16);
	return Buffer.concat([...localParts, centralDirectory, eocd]);
}
