import { auth } from "@/lib/auth";
import { getSidebarControlState } from "@/lib/module-controls";
import { SidebarNavClient } from "@/components/sidebar-nav-client";
import { isGuestRole } from "@/lib/guest-mode";

export async function AppSidebar() {
  const session = await auth();
  const controls = await getSidebarControlState(session?.user?.role);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar/95 p-3 xl:sticky xl:top-16 xl:block xl:h-[calc(100dvh-4rem)] xl:overflow-y-auto">
      <SidebarNavClient
        controls={controls}
        isGuest={isGuestRole(session?.user?.role)}
      />
    </aside>
  );
}
