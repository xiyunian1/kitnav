import Link from "next/link";
import { Sparkles } from "lucide-react";
import { SiteHeader } from "@/components/site-header";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main-content" className="flex-1">{children}</main>
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-3.5" aria-hidden="true" />
            </span>
            AI 聚合站
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link href="/image" className="transition-colors hover:text-foreground">
              图片生成
            </Link>
            <Link href="/ppt" className="transition-colors hover:text-foreground">
              PPT 生成
            </Link>
            <Link href="/materials" className="transition-colors hover:text-foreground">
              素材广场
            </Link>
          </nav>
          <p className="text-center">
            一站式 AI 创作平台
            {process.env.NEXT_PUBLIC_ICP && (
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 transition-colors hover:text-foreground"
              >
                {process.env.NEXT_PUBLIC_ICP}
              </a>
            )}
          </p>
        </div>
      </footer>
    </div>
  );
}
