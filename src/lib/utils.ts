import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 本站上传的图片走 Next 图片优化（sharp 缩放 + WebP），外站/内联图直接展示。
// 外站图保持 unoptimized 是有意为之：避免图片优化器代理任意域名。
export function isOptimizableImageUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith("/uploads/"));
}
