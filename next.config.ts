import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 图片优化只用于本站 /uploads/ 本地文件；外站图统一 unoptimized 直出，
  // 不配置 remotePatterns，避免优化器被当作任意域名的图片代理。
};

export default nextConfig;
