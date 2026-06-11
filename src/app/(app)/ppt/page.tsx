import { auth } from "@/lib/auth";
import { getPptBilling, listPptProjects } from "@/lib/ppt";
import { getStaticModuleMeta, requireModulePageAccess } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { redirect } from "next/navigation";
import { PptWorkbench } from "./ppt-workbench";

export const metadata = { title: "PPT 生成" };

export default async function PptPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const access = await requireModulePageAccess("ppt");
  if (!access.usable) {
    const meta = getStaticModuleMeta("ppt");
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
        icon={meta?.icon}
      />
    );
  }
  const userId = session.user.id;
  const [billing, projects] = await Promise.all([
    getPptBilling(userId),
    listPptProjects(userId),
  ]);

  return (
    <PptWorkbench
      initialProjects={projects}
      unitCost={billing.unitCost}
      useOwnKey={billing.useOwnKey}
      models={billing.models}
      defaultModel={billing.defaultModel}
    />
  );
}
