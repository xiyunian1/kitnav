import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { BRAND_DESCRIPTION, BRAND_NAME } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      default: BRAND_NAME,
      template: `%s · ${BRAND_NAME}`,
    },
    description: BRAND_DESCRIPTION,
    metadataBase: new URL(siteUrl),
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title: BRAND_NAME,
      description: BRAND_DESCRIPTION,
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: BRAND_NAME,
      description: BRAND_DESCRIPTION,
    },
    robots: {
      index: true,
      follow: true,
    },
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
