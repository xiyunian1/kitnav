import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Feedback accepts up to three 5MB screenshots. Keep a small multipart
    // allowance while Caddy still enforces the 35MB request-wide ceiling.
    serverActions: { bodySizeLimit: "16mb" },
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/uploads/materials/:path*",
          destination: "/api/files/materials/:path*",
        },
        {
          source: "/uploads/feedback/:path*",
          destination: "/api/files/feedback/:path*",
        },
        {
          source: "/projects/:path*",
          destination: "/api/files/private-static",
        },
        {
          source: "/uploads/:path*",
          destination: "/api/files/private-static",
        },
      ],
    };
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.git/**/*",
      "./.next/dev/**/*",
      "./.next/cache/**/*",
      "./.playwright-mcp/**/*",
      "./data/**/*",
      "./public/projects/**/*",
      "./public/uploads/**/*",
      "./prisma/*.db*",
      "./*.log",
    ],
  },
  // 图片优化只用于本站 /uploads/ 本地文件；外站图统一 unoptimized 直出，
  // 不配置 remotePatterns，避免优化器被当作任意域名的图片代理。
};

export default nextConfig;
