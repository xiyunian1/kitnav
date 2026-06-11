import { ComingSoon } from "@/components/coming-soon";
import { getModule } from "@/lib/modules";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { requireModulePageAccess } from "@/lib/module-controls";

export const metadata = { title: "音频生成" };

export default async function AudioPage() {
  const access = await requireModulePageAccess("audio");
  const m = getModule("audio")!;
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
