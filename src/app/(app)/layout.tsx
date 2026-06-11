import { SiteHeader } from "@/components/site-header";
import { AppSidebar } from "@/components/app-sidebar";
import { auth } from "@/lib/auth";
import { getSetting, getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, maintenanceMode, maintenanceMessage, announcements] = await Promise.all([
    auth(),
    getSettingNumber(SETTING_KEYS.MAINTENANCE_MODE),
    getSetting(SETTING_KEYS.MAINTENANCE_MESSAGE),
    prisma.siteAnnouncement.findMany({
      where: { enabled: true, placement: "APP" },
      orderBy: { updatedAt: "desc" },
      take: 2,
    }),
  ]);
  const blocked = maintenanceMode === 1 && session?.user?.role !== "ADMIN";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader showMobileNav />
      <div className="mx-auto flex w-full max-w-screen-2xl flex-1">
        <AppSidebar />
        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-8">
          {announcements.length > 0 && (
            <div className="mb-4 space-y-2">
              {announcements.map((item) => (
                <div key={item.id} className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                  <span className="font-medium">{item.title}</span>
                  <span className="ml-2 text-muted-foreground">{item.content}</span>
                </div>
              ))}
            </div>
          )}
          {blocked ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                {maintenanceMessage || "系统维护中，请稍后再试"}
              </CardContent>
            </Card>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
