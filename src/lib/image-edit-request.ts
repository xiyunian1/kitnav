import {
  isSupportedReferenceImageType,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_COUNT,
  MAX_REFERENCE_TOTAL_BYTES,
} from "@/lib/image-edit-capabilities";

export interface ReferenceImageUpload {
  blob: Blob;
  filename: string;
}

export class ReferenceImageRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceImageRequestError";
  }
}

function uploadFilename(blob: Blob, index: number) {
  const name = (blob as Blob & { name?: unknown }).name;
  return typeof name === "string" && name.trim()
    ? name
    : `reference-${index + 1}.png`;
}

export function parseReferenceImageUploads(form: FormData): ReferenceImageUpload[] {
  const modern = form.getAll("images");
  const legacy = form.get("image");
  const values = modern.length > 0 ? modern : legacy === null ? [] : [legacy];

  if (values.length === 0) {
    throw new ReferenceImageRequestError("请上传参考图");
  }
  if (values.length > MAX_REFERENCE_IMAGE_COUNT) {
    throw new ReferenceImageRequestError(
      `参考图最多上传 ${MAX_REFERENCE_IMAGE_COUNT} 张`,
    );
  }

  let totalBytes = 0;
  return values.map((value, index) => {
    if (!(value instanceof Blob)) {
      throw new ReferenceImageRequestError(`第 ${index + 1} 张参考图格式错误`);
    }
    if (value.size <= 0) {
      throw new ReferenceImageRequestError(`第 ${index + 1} 张参考图内容为空`);
    }
    if (value.size > MAX_REFERENCE_IMAGE_BYTES) {
      throw new ReferenceImageRequestError(
        `第 ${index + 1} 张参考图不能超过 8MB`,
      );
    }
    if (value.type && !isSupportedReferenceImageType(value.type)) {
      throw new ReferenceImageRequestError(
        `第 ${index + 1} 张参考图仅支持 PNG、JPG、WEBP 或 GIF`,
      );
    }
    totalBytes += value.size;
    if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) {
      throw new ReferenceImageRequestError("参考图总大小不能超过 30MB");
    }
    return {
      blob: value,
      filename: uploadFilename(value, index),
    };
  });
}
