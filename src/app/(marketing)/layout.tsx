import { SiteHeader } from "@/components/site-header";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        AI 聚合站 · 一站式 AI 创作平台
      </footer>
    </div>
  );
}
