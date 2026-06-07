import { auth } from "@/lib/auth";
import { getPptBilling, listPptProjects } from "@/lib/ppt";
import { redirect } from "next/navigation";
import { PptWorkbench } from "./ppt-workbench";

export const metadata = { title: "PPT 生成" };

export default async function PptPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
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
