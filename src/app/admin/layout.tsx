import { requireAdmin } from "@/lib/admin-guard";
import { recordDailyActivity } from "@/lib/activity";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  await recordDailyActivity(session.user.id);

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 overflow-x-auto p-6 lg:p-8">{children}</main>
    </div>
  );
}
