import {
	basename,
	extname,
	join,
} from "node:path";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import sharp from "sharp";
import type { ImageProvider } from "@/lib/providers/types";
import { RATIO_TO_PIXEL, type AspectRatio } from "@/lib/providers/types";
import { fetchPublicResource } from "@/lib/safe-fetch";
import {
	validateImageFile,
	type ValidatedImageFile,
} from "@/lib/image-file-validation";
import { executePptPython, getPptScriptPath } from "./python-tools";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SLICE_ELEMENTS = 36;
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_GENERATED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
]);
const IMAGE_ANALYSIS_CSV_HEADER =
	"No,Filename,Width,Height,AspectRatio,PixelAspectRatio,RatioSource,UsageCount,DisplayRatioVariants,AssetKind,SvgRenderable,PptxNativeSupported,SizeKB,Category,ImageArea_SxS,TextArea_SxS";

export interface PptImageDerivedItem {
	filename: string;
	parent_filename: string;
	status: "Generated" | "Needs-Manual";
	width?: number;
	height?: number;
	aspect_ratio?: string;
	generated_at?: string;
	last_error?: string;
}

export interface PptImageManifestItem {
	filename: string;
	prompt: string;
	aspect_ratio: string;
	status: "Pending" | "Generated" | "Failed" | "Needs-Manual";
	image_size?: string;
	purpose?: string;
	alt_text?: string;
	last_error?: string;
	generated_at?: string;
	model?: string;
	width?: number;
	height?: number;
	page_role?: "local" | "hero_page";
	text_policy?: "none" | "embedded";
	type?: string;
	slice_grid?: string;
	slice_names?: string[] | string;
	derived_items?: PptImageDerivedItem[];
	sliced_at?: string;
	[key: string]: unknown;
}

export interface PptImageManifest {
	project?: string;
	generated_at?: string;
	deck_rendering?: string;
	deck_palette?: string;
	color_scheme?: Record<string, unknown>;
	items: PptImageManifestItem[];
	[key: string]: unknown;
}

export interface GeneratePptManifestImagesInput {
	projectDir: string;
	provider: ImageProvider;
	model: string;
	maxImages: number;
	skillDir?: string;
	signal?: AbortSignal;
	requestTimeoutMs?: number;
	sliceImageSheet?: (request: PptImageSheetSliceRequest) => Promise<void>;
}

export interface PptImageSheetSliceRequest {
	sheetPath: string;
	outputDir: string;
	grid: string;
	names: string[];
	skillDir?: string;
}

export interface GeneratePptManifestImagesResult {
	generatedCount: number;
	billableCount: number;
	newlyGeneratedCount: number;
	reusedCount: number;
	failedCount: number;
	slicedCount: number;
	sliceFailedCount: number;
	plannedCount: number;
	manifestPath: string;
}

interface PptImageSlicePlan {
	item: PptImageManifestItem;
	grid: string;
	names: string[];
}

interface ValidImageOnDisk {
	buffer: Buffer;
	metadata: ValidatedImageFile;
}

export function hasPptImageManifest(projectDir: string) {
	return existsSync(join(projectDir, "images", "image_prompts.json"));
}

export function isPptImageManifestTerminal(
	projectDir: string,
	maxImages = 8,
) {
	try {
		const { manifest } = readPptImageManifest(projectDir, maxImages);
		return manifest.items.every(
			(item) => item.status === "Generated" || item.status === "Needs-Manual",
		);
	} catch {
		return false;
	}
}

export function ensurePptImageAnalysisCsv(projectDir: string, forceEmpty = false) {
	const analysisDir = join(projectDir, "analysis");
	const csvPath = join(analysisDir, "image_analysis.csv");
	if (forceEmpty || !existsSync(csvPath)) {
		mkdirSync(analysisDir, { recursive: true });
		writeFileSync(csvPath, `${IMAGE_ANALYSIS_CSV_HEADER}\n`, "utf-8");
	}
	return csvPath;
}

export function readPptImageManifest(
	projectDir: string,
	maxImages: number,
): { manifest: PptImageManifest; manifestPath: string } {
	const manifestPath = join(projectDir, "images", "image_prompts.json");
	if (!existsSync(manifestPath)) {
		throw new Error("PPT Master 未生成图片清单，无法执行所选图片模型。");
	}

	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
	} catch {
		throw new Error("PPT Master 图片清单不是有效 JSON。");
	}
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		throw new Error("PPT Master 图片清单格式不正确。");
	}

	const items = (manifest as { items?: unknown }).items;
	if (!Array.isArray(items) || items.length < 1) {
		throw new Error("PPT Master 图片清单没有可生成的图片。");
	}
	if (items.length > maxImages) {
		throw new Error(
			`PPT Master 规划了 ${items.length} 张图片，超过本任务上限 ${maxImages} 张。`,
		);
	}

	const filenames = new Set<string>();
	for (const [index, value] of items.entries()) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`图片清单第 ${index + 1} 项格式不正确。`);
		}
		const item = value as Partial<PptImageManifestItem>;
		const filename = item.filename?.trim() || "";
		const prompt = item.prompt?.trim() || "";
		const aspectRatio = item.aspect_ratio?.trim() || "";
		if (
			!filename ||
			filename !== basename(filename) ||
			!/^[A-Za-z0-9_-]{1,100}\.(?:png|jpe?g|webp)$/i.test(filename)
		) {
			throw new Error(`图片清单第 ${index + 1} 项文件名不安全。`);
		}
		if (!ALLOWED_IMAGE_EXTENSIONS.has(extname(filename).toLowerCase())) {
			throw new Error(`图片清单第 ${index + 1} 项图片格式不受支持。`);
		}
		if (filenames.has(filename.toLowerCase())) {
			throw new Error(`图片清单包含重复文件名：${filename}`);
		}
		if (!prompt || prompt.length > 12_000) {
			throw new Error(`图片清单第 ${index + 1} 项提示词为空或过长。`);
		}
		if (!aspectRatio) {
			throw new Error(`图片清单第 ${index + 1} 项缺少宽高比。`);
		}
		if (!isManifestStatus(item.status)) {
			throw new Error(`图片清单第 ${index + 1} 项状态不正确。`);
		}
		filenames.add(filename.toLowerCase());
	}

	for (const [index, value] of items.entries()) {
		const item = value as PptImageManifestItem;
		const slicePlan = readSlicePlan(item, index);
		if (!slicePlan) continue;
		item.slice_grid = slicePlan.grid;
		item.slice_names = slicePlan.names;
		for (const filename of slicePlan.names) {
			const key = filename.toLowerCase();
			if (filenames.has(key)) {
				throw new Error(`图片清单包含重复输出文件名：${filename}`);
			}
			filenames.add(key);
		}
	}

	return {
		manifest: manifest as PptImageManifest,
		manifestPath,
	};
}

export async function generatePptManifestImages(
	input: GeneratePptManifestImagesInput,
): Promise<GeneratePptManifestImagesResult> {
	const { manifest, manifestPath } = readPptImageManifest(
		input.projectDir,
		input.maxImages,
	);
	const outputDir = join(input.projectDir, "images");
	mkdirSync(outputDir, { recursive: true });
	const slicePlans = manifest.items
		.map((item, index) => readSlicePlan(item, index))
		.filter((plan): plan is PptImageSlicePlan => Boolean(plan));

	const results = await Promise.allSettled(
		manifest.items.map(async (item) => {
			const existing = await readValidImageOnDisk(
				join(outputDir, item.filename),
			);
			if (
				existing &&
				(item.status === "Generated" || item.status === "Needs-Manual")
			) {
				return { kind: "reused" as const, image: existing };
			}
			if (item.status === "Needs-Manual") {
				return { kind: "unavailable" as const };
			}
			return {
				kind: "generated" as const,
				image: await generateManifestItem(input, item),
			};
		}),
	);
	throwIfAborted(input.signal);

	let generatedCount = 0;
	let billableCount = 0;
	let newlyGeneratedCount = 0;
	let reusedCount = 0;
	let failedCount = 0;
	for (const [index, result] of results.entries()) {
		const item = manifest.items[index];
		if (result.status === "fulfilled") {
			try {
				if (result.value.kind === "unavailable") throw new Error("unavailable");
				const isNewGeneration = result.value.kind === "generated";
				const image = isNewGeneration
					? await convertImageForManifestFilename(
							item.filename,
							result.value.image,
						)
					: result.value.image;
				if (isNewGeneration) {
					writeBufferAtomically(join(outputDir, item.filename), image.buffer);
					item.model = input.model;
					newlyGeneratedCount += 1;
					billableCount += 1;
				} else {
					reusedCount += 1;
					if (item.status === "Generated" && item.model?.trim()) {
						billableCount += 1;
					} else {
						delete item.model;
					}
				}
				item.status = "Generated";
				item.generated_at ||= new Date().toISOString();
				item.width = image.metadata.width;
				item.height = image.metadata.height;
					delete item.last_error;
					generatedCount += 1;
					writeManifestAtomically(manifestPath, manifest);
					continue;
			} catch {
				// The manifest receives the same generic failure as provider errors.
			}
		}
		item.status = "Needs-Manual";
		item.last_error = "图片生成失败，已自动重试 1 次";
		delete item.generated_at;
		delete item.model;
		delete item.width;
		delete item.height;
		failedCount += 1;
		writeManifestAtomically(manifestPath, manifest);
	}
	writeManifestAtomically(manifestPath, manifest);

	const sliceResult = await processPptImageSheets(input, slicePlans, outputDir);
	if (slicePlans.length > 0) {
		synchronizePptSliceArtifacts(input.projectDir, slicePlans);
	}
	writeManifestAtomically(manifestPath, manifest);

	return {
		generatedCount,
		billableCount,
		newlyGeneratedCount,
		reusedCount,
		failedCount,
		slicedCount: sliceResult.slicedCount,
		sliceFailedCount: sliceResult.failedCount,
		plannedCount: manifest.items.length,
		manifestPath,
	};
}

async function generateManifestItem(
	input: GeneratePptManifestImagesInput,
	item: PptImageManifestItem,
) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		throwIfAborted(input.signal);
		try {
			const generated = await input.provider.generate({
				prompt: item.prompt,
				size: imageSizeForAspectRatio(item.aspect_ratio),
				count: 1,
				signal: input.signal,
				timeoutMs: input.requestTimeoutMs,
			});
			const url = generated.urls[0];
			if (!url) throw new Error("上游未返回图片");
			return await readGeneratedImage(url, input.signal);
		} catch (error) {
			throwIfAborted(input.signal);
			lastError = error;
		}
	}
	throw lastError instanceof Error ? lastError : new Error("图片生成失败");
}

function isManifestStatus(
	value: unknown,
): value is PptImageManifestItem["status"] {
	return ["Pending", "Generated", "Failed", "Needs-Manual"].includes(
		String(value),
	);
}

function imageSizeForAspectRatio(value: string) {
	const ratio = value.trim() as AspectRatio;
	return RATIO_TO_PIXEL[ratio] ?? "1536x1024";
}

function readSlicePlan(
	item: PptImageManifestItem,
	index: number,
): PptImageSlicePlan | null {
	const hasGrid = item.slice_grid !== undefined && item.slice_grid !== null;
	const hasNames = item.slice_names !== undefined && item.slice_names !== null;
	if (!hasGrid && !hasNames) return null;
	if (!hasGrid || !hasNames) {
		throw new Error(
			`图片清单第 ${index + 1} 项必须同时提供 slice_grid 和 slice_names。`,
		);
	}
	if (typeof item.slice_grid !== "string") {
		throw new Error(`图片清单第 ${index + 1} 项 slice_grid 格式不正确。`);
	}
	const gridMatch = item.slice_grid.trim().match(/^(\d{1,2})\s*[xX×]\s*(\d{1,2})$/);
	if (!gridMatch) {
		throw new Error(`图片清单第 ${index + 1} 项 slice_grid 格式不正确。`);
	}
	const rows = Number(gridMatch[1]);
	const columns = Number(gridMatch[2]);
	const expectedCount = rows * columns;
	if (
		rows < 1 ||
		columns < 1 ||
		expectedCount < 1 ||
		expectedCount > MAX_SLICE_ELEMENTS
	) {
		throw new Error(
			`图片清单第 ${index + 1} 项切片数量必须在 1-${MAX_SLICE_ELEMENTS} 之间。`,
		);
	}

	const rawNames = Array.isArray(item.slice_names)
		? item.slice_names
		: typeof item.slice_names === "string"
			? item.slice_names.split(",")
			: [];
	if (
		rawNames.length !== expectedCount ||
		rawNames.some((name) => typeof name !== "string" || !name.trim())
	) {
		throw new Error(
			`图片清单第 ${index + 1} 项 slice_names 数量与 ${rows}x${columns} 网格不一致。`,
		);
	}
	const names = rawNames.map((name, nameIndex) => {
		const trimmed = String(name).trim();
		if (!/^[A-Za-z0-9_-]{1,100}(?:\.png)?$/i.test(trimmed)) {
			throw new Error(
				`图片清单第 ${index + 1} 项第 ${nameIndex + 1} 个切片文件名不安全。`,
			);
		}
		const extension = extname(trimmed).toLowerCase();
		if (extension && extension !== ".png") {
			throw new Error(
				`图片清单第 ${index + 1} 项切片输出必须使用 PNG 格式。`,
			);
		}
		return extension ? trimmed : `${trimmed}.png`;
	});
	if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
		throw new Error(`图片清单第 ${index + 1} 项包含重复切片文件名。`);
	}
	return {
		item,
		grid: `${rows}x${columns}`,
		names,
	};
}

async function readGeneratedImage(url: string, signal?: AbortSignal) {
	let buffer: Buffer;
	if (url.startsWith("data:")) {
		if (url.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024) {
			throw new Error("上游生成的图片过大");
		}
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error("无法读取上游生成的图片");
		buffer = Buffer.from(await response.arrayBuffer());
	} else {
		const resource = await fetchPublicResource(url, {
			maxBytes: MAX_IMAGE_BYTES,
			timeoutMs: 30_000,
			maxRedirects: 3,
			signal,
		});
		buffer = resource.buffer;
	}
	if (buffer.length < 8 || buffer.length > MAX_IMAGE_BYTES) {
		throw new Error("上游生成的图片为空或过大");
	}
	const image = await validateImageFile(buffer, {
		allowedMimeTypes: ALLOWED_GENERATED_IMAGE_TYPES,
		invalidMessage: "上游返回的图片无效或已损坏",
		unsupportedMessage: "上游返回的内容不是支持的图片格式",
		limitMessage: "上游返回的图片像素尺寸过大",
	});
	return { buffer, metadata: image };
}

async function convertImageForManifestFilename(
	filename: string,
	image: ValidImageOnDisk,
): Promise<ValidImageOnDisk> {
	const requestedExtension = extname(filename).toLowerCase();
	const actualExtension = `.${image.metadata.extension}`;
	if (
		requestedExtension === actualExtension ||
		(requestedExtension === ".jpeg" && actualExtension === ".jpg")
	) {
		return image;
	}

	let buffer: Buffer;
	if (requestedExtension === ".png") {
		buffer = await sharp(image.buffer).png().toBuffer();
	} else if (requestedExtension === ".webp") {
		buffer = await sharp(image.buffer).webp({ quality: 92 }).toBuffer();
	} else {
		buffer = await sharp(image.buffer).jpeg({ quality: 92 }).toBuffer();
	}
	if (buffer.length > MAX_IMAGE_BYTES) throw new Error("转换后的图片过大");
	const metadata = await validateImageFile(buffer, {
		allowedMimeTypes: ALLOWED_GENERATED_IMAGE_TYPES,
		invalidMessage: "图片格式转换失败",
		unsupportedMessage: "图片格式转换失败",
		limitMessage: "转换后的图片像素尺寸过大",
	});
	return { buffer, metadata };
}

async function readValidImageOnDisk(path: string): Promise<ValidImageOnDisk | null> {
	if (!existsSync(path)) return null;
	try {
		const buffer = readFileSync(path);
		if (buffer.length < 8 || buffer.length > MAX_IMAGE_BYTES) return null;
		const metadata = await validateImageFile(buffer, {
			allowedMimeTypes: ALLOWED_GENERATED_IMAGE_TYPES,
		});
		return { buffer, metadata };
	} catch {
		return null;
	}
}

async function processPptImageSheets(
	input: GeneratePptManifestImagesInput,
	plans: PptImageSlicePlan[],
	outputDir: string,
) {
	let slicedCount = 0;
	let failedCount = 0;
	for (const plan of plans) {
		throwIfAborted(input.signal);
		const parentPath = join(outputDir, plan.item.filename);
		const parent =
			plan.item.status === "Generated"
				? await readValidImageOnDisk(parentPath)
				: null;
		if (!parent) {
			removeSliceOutputs(outputDir, plan.names);
			markSliceItemsUnavailable(plan, "父插画表未生成，无法切片");
			failedCount += plan.names.length;
			continue;
		}

		let outputs = await readSliceOutputs(outputDir, plan.names);
		if (!outputs) {
			removeSliceOutputs(outputDir, plan.names);
			try {
				await runPptImageSheetSlicer(input, {
					sheetPath: parentPath,
					outputDir,
					grid: plan.grid,
					names: plan.names,
					skillDir: input.skillDir,
				});
				throwIfAborted(input.signal);
				outputs = await readSliceOutputs(outputDir, plan.names);
				if (!outputs) throw new Error("切片输出数量或文件格式不正确");
			} catch {
				throwIfAborted(input.signal);
				removeSliceOutputs(outputDir, plan.names);
				markSliceItemsUnavailable(plan, "插画表切片失败，需要人工处理");
				failedCount += plan.names.length;
				continue;
			}
		}
		markSliceItemsGenerated(plan, outputs);
		slicedCount += outputs.length;
	}
	return { slicedCount, failedCount };
}

async function runPptImageSheetSlicer(
	input: GeneratePptManifestImagesInput,
	request: PptImageSheetSliceRequest,
) {
	if (input.sliceImageSheet) {
		await input.sliceImageSheet(request);
		return;
	}
	await executePptPython(
		getPptScriptPath("slice_images.py", request.skillDir),
		[
			request.sheetPath,
			"--grid",
			request.grid,
			"--output",
			request.outputDir,
			"--names",
			request.names.join(","),
			"--trim",
			"--alpha",
		],
		180_000,
		request.skillDir,
	);
}

async function readSliceOutputs(outputDir: string, names: string[]) {
	const outputs: ValidImageOnDisk[] = [];
	for (const name of names) {
		const image = await readValidImageOnDisk(join(outputDir, name));
		if (!image || image.metadata.mimeType !== "image/png") return null;
		outputs.push(image);
	}
	return outputs;
}

function removeSliceOutputs(outputDir: string, names: string[]) {
	for (const name of names) rmSync(join(outputDir, name), { force: true });
}

function markSliceItemsGenerated(
	plan: PptImageSlicePlan,
	outputs: ValidImageOnDisk[],
) {
	const now = new Date().toISOString();
	const previous = new Map(
		(plan.item.derived_items || []).map((item) => [
			item.filename.toLowerCase(),
			item,
		]),
	);
	plan.item.derived_items = plan.names.map((filename, index) => ({
		filename,
		parent_filename: plan.item.filename,
		status: "Generated",
		width: outputs[index].metadata.width,
		height: outputs[index].metadata.height,
		aspect_ratio: formatImageRatio(
			outputs[index].metadata.width,
			outputs[index].metadata.height,
		),
		generated_at: previous.get(filename.toLowerCase())?.generated_at || now,
	}));
	plan.item.sliced_at ||= now;
}

function markSliceItemsUnavailable(plan: PptImageSlicePlan, message: string) {
	plan.item.derived_items = plan.names.map((filename) => ({
		filename,
		parent_filename: plan.item.filename,
		status: "Needs-Manual",
		last_error: message,
	}));
	delete plan.item.sliced_at;
}

function synchronizePptSliceArtifacts(
	projectDir: string,
	plans: PptImageSlicePlan[],
) {
	synchronizePptImageResourceTable(projectDir, plans);
	synchronizePptSpecLockImages(projectDir, plans);
}

function synchronizePptImageResourceTable(
	projectDir: string,
	plans: PptImageSlicePlan[],
) {
	const path = join(projectDir, "design_spec.md");
	if (!existsSync(path)) {
		throw new Error("PPT 插画表切片缺少 design_spec.md 资源契约。");
	}
	const content = readFileSync(path, "utf-8");
	const table = findPptImageResourceTable(content);
	if (!table) {
		throw new Error("design_spec.md 缺少官方 VIII. Image Resource List 表格。");
	}
	const filenameIndex = table.headers.indexOf("filename");
	const dimensionsIndex = table.headers.indexOf("dimensions");
	const ratioIndex = table.headers.indexOf("ratio");
	const typeIndex = table.headers.indexOf("type");
	const acquireViaIndex = table.headers.indexOf("acquire via");
	const statusIndex = table.headers.indexOf("status");
	if (
		filenameIndex < 0 ||
		typeIndex < 0 ||
		acquireViaIndex < 0 ||
		statusIndex < 0
	) {
		throw new Error("design_spec.md 图片资源表缺少必要列。");
	}

	const rowsByFilename = new Map<string, (typeof table.rows)[number]>();
	for (const row of table.rows) {
		const filename = cleanMarkdownCell(row.cells[filenameIndex]);
		if (!filename) continue;
		const key = filename.toLowerCase();
		if (rowsByFilename.has(key)) {
			throw new Error(`design_spec.md 图片资源文件名重复：${filename}。`);
		}
		rowsByFilename.set(key, row);
	}

	const expectedSlices = new Set(
		plans.flatMap((plan) => plan.names.map((name) => name.toLowerCase())),
	);
	for (const row of table.rows) {
		if (
			cleanMarkdownCell(row.cells[acquireViaIndex]).toLowerCase() === "slice"
		) {
			const filename = cleanMarkdownCell(row.cells[filenameIndex]);
			if (!expectedSlices.has(filename.toLowerCase())) {
				throw new Error(
					`design_spec.md 切片资源 ${filename} 缺少父插画表配置。`,
				);
			}
		}
	}

	for (const plan of plans) {
		const parentRow = rowsByFilename.get(plan.item.filename.toLowerCase());
		if (!parentRow) {
			throw new Error(
				`design_spec.md 缺少插画表资源行：${plan.item.filename}。`,
			);
		}
		if (
			cleanMarkdownCell(parentRow.cells[acquireViaIndex]).toLowerCase() !== "ai" ||
			cleanMarkdownCell(parentRow.cells[typeIndex]).toLowerCase() !==
				"illustration sheet"
		) {
			throw new Error(
				`design_spec.md 中 ${plan.item.filename} 必须是 ai / Illustration Sheet。`,
			);
		}
		parentRow.cells[statusIndex] = plan.item.status;
		if (plan.item.status === "Generated" && plan.item.width && plan.item.height) {
			if (dimensionsIndex >= 0) {
				parentRow.cells[dimensionsIndex] = `${plan.item.width}x${plan.item.height}`;
			}
			if (ratioIndex >= 0) {
				parentRow.cells[ratioIndex] = formatImageRatio(
					plan.item.width,
					plan.item.height,
				);
			}
		}

		for (const derived of plan.item.derived_items || []) {
			const row = rowsByFilename.get(derived.filename.toLowerCase());
			if (!row) {
				throw new Error(
					`design_spec.md 缺少切片资源行：${derived.filename}。`,
				);
			}
			if (
				cleanMarkdownCell(row.cells[acquireViaIndex]).toLowerCase() !== "slice"
			) {
				throw new Error(
					`design_spec.md 中 ${derived.filename} 的 Acquire Via 必须是 slice。`,
				);
			}
			row.cells[statusIndex] = derived.status;
			if (derived.status === "Generated" && derived.width && derived.height) {
				if (dimensionsIndex >= 0) {
					row.cells[dimensionsIndex] = `${derived.width}x${derived.height}`;
				}
				if (ratioIndex >= 0) {
					row.cells[ratioIndex] =
						derived.aspect_ratio || formatImageRatio(derived.width, derived.height);
				}
			}
		}
	}

	for (const row of table.rows) {
		table.lines[row.lineIndex] = `| ${row.cells.join(" | ")} |`;
	}
	writeTextAtomically(path, `${table.lines.join("\n").replace(/\n+$/, "")}\n`);
}

function findPptImageResourceTable(content: string) {
	const lines = content.split(/\r?\n/);
	const sectionStart = lines.findIndex((line) =>
		/^##\s+VIII\.\s+Image Resource List\b/i.test(line.trim()),
	);
	if (sectionStart < 0) return null;
	let sectionEnd = lines.length;
	for (let index = sectionStart + 1; index < lines.length; index += 1) {
		if (/^##\s+/.test(lines[index].trim())) {
			sectionEnd = index;
			break;
		}
	}
	let headerIndex = -1;
	let headers: string[] = [];
	for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
		if (!lines[index].trim().startsWith("|")) continue;
		const cells = parseMarkdownTableRow(lines[index]);
		const normalized = cells.map(normalizeMarkdownHeader);
		if (normalized.includes("filename") && normalized.includes("acquire via")) {
			headerIndex = index;
			headers = normalized;
			break;
		}
	}
	if (headerIndex < 0) return null;

	const rows: Array<{ lineIndex: number; cells: string[] }> = [];
	for (let index = headerIndex + 1; index < sectionEnd; index += 1) {
		const line = lines[index].trim();
		if (!line.startsWith("|")) {
			if (rows.length > 0) break;
			continue;
		}
		const cells = parseMarkdownTableRow(lines[index]);
		if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue;
		while (cells.length < headers.length) cells.push("");
		rows.push({ lineIndex: index, cells });
	}
	return { lines, headers, rows };
}

function parseMarkdownTableRow(line: string) {
	const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
	const cells: string[] = [];
	let current = "";
	for (let index = 0; index < trimmed.length; index += 1) {
		const character = trimmed[index];
		if (character === "|" && trimmed[index - 1] !== "\\") {
			cells.push(current.trim());
			current = "";
		} else {
			current += character;
		}
	}
	cells.push(current.trim());
	return cells;
}

function normalizeMarkdownHeader(value: string) {
	return cleanMarkdownCell(value).replace(/\s+/g, " ").toLowerCase();
}

function cleanMarkdownCell(value = "") {
	return value.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
}

function synchronizePptSpecLockImages(
	projectDir: string,
	plans: PptImageSlicePlan[],
) {
	const path = join(projectDir, "spec_lock.md");
	if (!existsSync(path)) {
		throw new Error("PPT 插画表切片缺少 spec_lock.md 图片契约。");
	}
	const lines = readFileSync(path, "utf-8").split(/\r?\n/);
	const parentPaths = new Set(
		plans.map((plan) => `images/${plan.item.filename}`.toLowerCase()),
	);
	const expectedPaths = new Map(
		plans.flatMap((plan) =>
			plan.names.map((name) => [`images/${name}`.toLowerCase(), name] as const),
		),
	);
	let sectionStart = lines.findIndex((line) => /^##\s+images\s*$/i.test(line));
	if (sectionStart < 0) {
		const nextSection = lines.findIndex((line) =>
			/^##\s+(?:page_rhythm|page_layouts)\b/i.test(line),
		);
		sectionStart = nextSection < 0 ? lines.length : nextSection;
		lines.splice(sectionStart, 0, "## images", "");
	}
	let sectionEnd = lines.length;
	for (let index = sectionStart + 1; index < lines.length; index += 1) {
		if (/^##\s+/.test(lines[index])) {
			sectionEnd = index;
			break;
		}
	}

	const presentPaths = new Set<string>();
	const existingKeys = new Set<string>();
	for (let index = sectionEnd - 1; index > sectionStart; index -= 1) {
		const entry = parseSpecLockImageEntry(lines[index]);
		if (!entry) continue;
		existingKeys.add(entry.key.toLowerCase());
		const normalizedPath = entry.path.toLowerCase();
		if (parentPaths.has(normalizedPath)) {
			lines.splice(index, 1);
			sectionEnd -= 1;
			continue;
		}
		if (expectedPaths.has(normalizedPath)) {
			lines[index] = `- ${entry.key}: ${entry.path} | no-crop`;
			presentPaths.add(normalizedPath);
		}
	}

	let insertionIndex = sectionStart + 1;
	while (
		insertionIndex < sectionEnd &&
		(/^\s*-\s+/.test(lines[insertionIndex]) || !lines[insertionIndex].trim())
	) {
		insertionIndex += 1;
	}
	const additions: string[] = [];
	for (const [normalizedPath, filename] of expectedPaths) {
		if (presentPaths.has(normalizedPath)) continue;
		const key = uniqueSpecLockImageKey(filename, existingKeys);
		existingKeys.add(key.toLowerCase());
		additions.push(`- ${key}: images/${filename} | no-crop`);
	}
	if (additions.length > 0) lines.splice(insertionIndex, 0, ...additions);
	writeTextAtomically(path, `${lines.join("\n").replace(/\n+$/, "")}\n`);
}

function parseSpecLockImageEntry(line: string) {
	const match = line.match(
		/^\s*-\s*([^:]+):\s*`?(images\/[A-Za-z0-9_.-]+)`?(?:\s*\|.*)?\s*$/i,
	);
	return match ? { key: match[1].trim(), path: match[2] } : null;
}

function uniqueSpecLockImageKey(filename: string, existing: Set<string>) {
	const stem = filename
		.replace(/\.[^.]+$/, "")
		.replace(/[^A-Za-z0-9_-]/g, "_")
		.replace(/^_+|_+$/g, "") || "slice_image";
	let candidate = stem;
	let suffix = 2;
	while (existing.has(candidate.toLowerCase())) {
		candidate = `${stem}_${suffix}`;
		suffix += 1;
	}
	return candidate;
}

function formatImageRatio(width: number, height: number) {
	const divisor = greatestCommonDivisor(width, height);
	return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b > 0) [a, b] = [b, a % b];
	return a || 1;
}

function writeBufferAtomically(path: string, buffer: Buffer) {
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, buffer);
	renameSync(temporaryPath, path);
}

function writeTextAtomically(path: string, content: string) {
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, content, "utf-8");
	renameSync(temporaryPath, path);
}

function writeManifestAtomically(path: string, manifest: PptImageManifest) {
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
	renameSync(temporaryPath, path);
}

function throwIfAborted(signal?: AbortSignal) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new Error("用户已停止生成");
}
