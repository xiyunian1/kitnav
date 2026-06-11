import { auth } from "@/lib/auth";
import { getSidebarControlState } from "@/lib/module-controls";
import { SidebarNavClient } from "@/components/sidebar-nav-client";

export async function AppSidebar() {
  const session = await auth();
  const controls = await getSidebarControlState(session?.user?.role);

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-4 lg:block">
      <SidebarNavClient controls={controls} />
    </aside>
  );
}
