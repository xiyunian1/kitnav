import { requireAdmin } from "@/lib/admin-guard";
import { recordDailyActivity } from "@/lib/activity";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileHeader } from "@/components/admin/admin-mobile-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  await recordDailyActivity(session.user.id);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AdminMobileHeader />
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
