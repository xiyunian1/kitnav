import {
  isSupportedReferenceImageType,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_COUNT,
  MAX_REFERENCE_TOTAL_BYTES,
} from "@/lib/image-edit-capabilities";

const REFERENCE_TARGET_BYTES = 2 * 1024 * 1024;
const REFERENCE_MAX_DIMENSION = 2048;
const REFERENCE_MAX_SOURCE_BYTES = MAX_REFERENCE_TOTAL_BYTES;
const WEBP_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58] as const;

function loadImage(file: File) {
  return new Promise<{ image: HTMLImageElement; objectUrl: string }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`无法解析参考图「${file.name}」`));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法压缩参考图"));
      },
      "image/webp",
      quality,
    );
  });
}

function compressedFilename(filename: string) {
  const stem = filename.replace(/\.[^.]+$/, "").trim() || "reference";
  return `${stem}.webp`;
}

export async function prepareReferenceFile(file: File): Promise<File> {
  if (!isSupportedReferenceImageType(file.type)) {
    throw new Error(`参考图「${file.name}」仅支持 PNG、JPG、WEBP 或 GIF`);
  }
  if (file.size <= 0) throw new Error(`参考图「${file.name}」内容为空`);
  if (file.size > REFERENCE_MAX_SOURCE_BYTES) {
    throw new Error(`参考图「${file.name}」原文件不能超过 30MB`);
  }

  const { image, objectUrl } = await loadImage(file);
  try {
    const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longestEdge) throw new Error(`无法读取参考图「${file.name}」的尺寸`);
    if (longestEdge <= REFERENCE_MAX_DIMENSION && file.size <= REFERENCE_TARGET_BYTES) {
      return file;
    }

    let scale = Math.min(1, REFERENCE_MAX_DIMENSION / longestEdge);
    for (let resizeAttempt = 0; resizeAttempt < 5; resizeAttempt += 1) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建图片压缩画布");
      context.drawImage(image, 0, 0, width, height);

      for (const quality of WEBP_QUALITIES) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= REFERENCE_TARGET_BYTES) {
          const normalized = new File([blob], compressedFilename(file.name), {
            type: "image/webp",
            lastModified: file.lastModified,
          });
          if (normalized.size > MAX_REFERENCE_IMAGE_BYTES) {
            throw new Error(`参考图「${file.name}」压缩后仍超过 8MB`);
          }
          return normalized;
        }
      }
      scale *= 0.8;
    }
    throw new Error(`参考图「${file.name}」压缩后仍超过 2MB`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareReferenceFiles(
  files: File[],
  existingFiles: readonly File[],
) {
  if (files.length === 0) return [];
  if (existingFiles.length + files.length > MAX_REFERENCE_IMAGE_COUNT) {
    throw new Error(`参考图最多上传 ${MAX_REFERENCE_IMAGE_COUNT} 张`);
  }

  const prepared: File[] = [];
  let totalBytes = existingFiles.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    const normalized = await prepareReferenceFile(file);
    totalBytes += normalized.size;
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new Error("参考图总大小不能超过 30MB");
    }
    prepared.push(normalized);
  }
  return prepared;
}
