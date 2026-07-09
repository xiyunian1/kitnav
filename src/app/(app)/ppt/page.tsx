import { auth } from "@/lib/auth";
import { requireModulePageAccess, getStaticModuleMeta } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { prisma } from "@/lib/db";
import { resolvePptAgentBillingMode } from "@/lib/ppt-agent/billing";
import { getProjectSvgPreviews } from "@/lib/ppt-agent/paths";
import { PptWorkbench } from "./components/workbench";

export const metadata = { title: "PPT 生成" };

export default async function PptPage() {
  const session = await auth();
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

  const [projectRows, billingMode] = await Promise.all([
    prisma.pptProject.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        progress: true,
        currentPhase: true,
        slideCount: true,
        aspectRatio: true,
        createdAt: true,
        completedAt: true,
        updatedAt: true,
        pptxPath: true,
      },
    }),
    resolvePptAgentBillingMode(session!.user.id),
  ]);

  const recentProjects = await Promise.all(
    projectRows.map(async (project) => {
      const previews = await getProjectSvgPreviews(project.id);
      return {
        ...project,
        coverUrl: previews[0]?.url ?? null,
      };
    }),
  );

  const creditsPerSlide = Number(process.env.PPT_CREDITS_PER_SLIDE || 10);
  const displayName = session?.user?.name?.trim();

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-10 pb-10">
      <div className="pt-3 text-center sm:pt-7">
        <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
          {displayName ? `Hi ${displayName}，` : "你好，"}开始创建演示文稿
        </h1>
      </div>

      <PptWorkbench
        recentProjects={recentProjects}
        useOwnKey={billingMode.useOwnKey}
        creditsPerSlide={creditsPerSlide}
      />
    </div>
  );
}
