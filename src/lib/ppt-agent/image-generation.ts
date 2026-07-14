import {
	basename,
	extname,
	join,
	parse,
} from "node:path";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import type { ImageProvider } from "@/lib/providers/types";
import { RATIO_TO_PIXEL, type AspectRatio } from "@/lib/providers/types";
import { fetchPublicResource } from "@/lib/safe-fetch";
import { validateImageFile } from "@/lib/image-file-validation";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const ALLOWED_GENERATED_IMAGE_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
]);
const IMAGE_ANALYSIS_CSV_HEADER =
	"No,Filename,Width,Height,AspectRatio,PixelAspectRatio,RatioSource,UsageCount,DisplayRatioVariants,AssetKind,SvgRenderable,PptxNativeSupported,SizeKB,Category,ImageArea_SxS,TextArea_SxS";

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
	[key: string]: unknown;
}

export interface PptImageManifest {
	items: PptImageManifestItem[];
	[key: string]: unknown;
}

export interface GeneratePptManifestImagesInput {
	projectDir: string;
	provider: ImageProvider;
	model: string;
	maxImages: number;
	signal?: AbortSignal;
	requestTimeoutMs?: number;
}

export interface GeneratePptManifestImagesResult {
	generatedCount: number;
	failedCount: number;
	plannedCount: number;
	manifestPath: string;
}

export function hasPptImageManifest(projectDir: string) {
	return existsSync(join(projectDir, "images", "image_prompts.json"));
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
		if (!filename || filename !== basename(filename)) {
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

	const results = await Promise.allSettled(
		manifest.items.map((item) => generateManifestItem(input, item)),
	);
	throwIfAborted(input.signal);

	let generatedCount = 0;
	let failedCount = 0;
	const outputFilenames = new Set<string>();
	results.forEach((result, index) => {
		const item = manifest.items[index];
		if (result.status === "fulfilled") {
			try {
				const filename = normalizedOutputFilename(
					item.filename,
					result.value.image.extension,
				);
				if (outputFilenames.has(filename.toLowerCase())) {
					throw new Error("图片输出文件名冲突");
				}
				writeFileSync(
					join(outputDir, filename),
					result.value.image.buffer,
				);
				outputFilenames.add(filename.toLowerCase());
				item.filename = filename;
				item.status = "Generated";
				item.generated_at = new Date().toISOString();
				item.model = input.model;
				delete item.last_error;
				generatedCount += 1;
				return;
			} catch {
				// The manifest receives the same generic failure as provider errors.
			}
		}
		item.status = "Needs-Manual";
		item.last_error = "图片生成失败，已自动重试 1 次";
		delete item.generated_at;
		delete item.model;
		failedCount += 1;
	});
	writeManifestAtomically(manifestPath, manifest);

	return {
		generatedCount,
		failedCount,
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
			const image = await readGeneratedImage(url, input.signal);
			return { item, image };
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

function normalizedOutputFilename(filename: string, extension: string) {
	const stem = parse(filename).name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100);
	if (!stem) throw new Error("图片文件名无效");
	const originalExtension = extname(filename).slice(1).toLowerCase();
	return originalExtension === extension ||
		(originalExtension === "jpeg" && extension === "jpg")
		? `${stem}.${extension}`
		: `${stem}-${originalExtension}.${extension}`;
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
	return { buffer, extension: image.extension };
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
