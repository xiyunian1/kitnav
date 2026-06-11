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
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        <p>AI 聚合站 · 一站式 AI 创作平台</p>
        {process.env.NEXT_PUBLIC_ICP && (
          <p className="mt-1">
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              {process.env.NEXT_PUBLIC_ICP}
            </a>
          </p>
        )}
      </footer>
    </div>
  );
}
