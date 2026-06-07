import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { getSetting } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSetting(SETTING_KEYS.SITE_NAME);
  return {
    title: {
      default: siteName || "AI 聚合站",
      template: `%s · ${siteName || "AI 聚合站"}`,
    },
    description: "一站式 AI 创作平台：图片生成、视频生成、PPT 生成等",
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geistSans.variable} antialiased`}>
        <ThemeProvider>
          {children}
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
