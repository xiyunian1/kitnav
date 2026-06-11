import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { requireModulePageAccess } from "@/lib/module-controls";

export const metadata = { title: "代码助手" };

export default async function CodePage() {
  const access = await requireModulePageAccess("code");
  const m = getModule("code")!;
  if (access.status !== "coming-soon") {
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
        icon={m.icon}
      />
    );
  }
  return <ComingSoon name={m.name} description={m.description} icon={m.icon} />;
}
