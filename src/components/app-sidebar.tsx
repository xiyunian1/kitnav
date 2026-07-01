import { auth } from "@/lib/auth";
import { getSidebarControlState } from "@/lib/module-controls";
import { SidebarNavClient } from "@/components/sidebar-nav-client";

export async function AppSidebar() {
  const session = await auth();
  const controls = await getSidebarControlState(session?.user?.role);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar/95 p-3 lg:sticky lg:top-16 lg:block lg:h-[calc(100dvh-4rem)] lg:overflow-y-auto">
      <SidebarNavClient controls={controls} />
    </aside>
  );
}
