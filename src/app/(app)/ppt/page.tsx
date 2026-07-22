import { auth } from "@/lib/auth";
import {
  getModuleAccess,
  getStaticModuleMeta,
  requireModulePageAccess,
} from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { prisma } from "@/lib/db";
import { getModuleModelOptions } from "@/lib/providers";
import { getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { getProjectSvgPreviews } from "@/lib/ppt-agent/paths";
import { toPublicPptProject } from "@/lib/ppt-agent/project-public";
import { getPptCreditsPerSlide } from "@/lib/ppt-agent/billing";
import { PptWorkbench } from "./components/workbench";
import { canRetryPptProject } from "@/lib/ppt-agent/retry";

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

  const [
    projectRows,
    modelOptions,
    storedImageModelOptions,
    imageCreditCost,
    imageModuleEnabled,
    imageAccess,
  ] = await Promise.all([
    prisma.pptProject.findMany({
      where: { userId: session!.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        sourceType: true,
        status: true,
        currentPhase: true,
        slideCount: true,
        aspectRatio: true,
        createdAt: true,
        completedAt: true,
        updatedAt: true,
        confirmationWaitStartedAt: true,
        confirmationWaitSeconds: true,
        pptxPath: true,
        artifactsDeletedAt: true,
        error: true,
      },
    }),
    getModuleModelOptions(session!.user.id, "PPT"),
    getModuleModelOptions(session!.user.id, "IMAGE"),
    getSettingNumber(SETTING_KEYS.IMAGE_CREDIT_COST),
    getSettingNumber(SETTING_KEYS.IMAGE_MODULE_ENABLED),
    getModuleAccess("image", session?.user?.role),
  ]);
  const imageModelOptions =
    imageModuleEnabled === 1 && imageAccess.usable ? storedImageModelOptions : [];

  const recentProjects = await Promise.all(
    projectRows.map(async (project) => {
      const previews = await getProjectSvgPreviews(project.id);
      const canRetry = canRetryPptProject(project);
      return {
        ...toPublicPptProject(project),
        coverUrl: previews[0]?.url ?? null,
        canRetry,
      };
    }),
  );

  const creditsPerSlide = getPptCreditsPerSlide();
  const displayName = session?.user?.name?.trim();

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-8 pb-10">
      <div className="pt-2 text-center sm:pt-4">
        <h1 className="text-2xl font-semibold tracking-normal sm:text-3xl">
          {displayName ? `Hi ${displayName}，` : "你好，"}开始创建演示文稿
        </h1>
      </div>

      <PptWorkbench
        recentProjects={recentProjects}
        modelOptions={modelOptions}
        imageModelOptions={imageModelOptions}
        creditsPerSlide={creditsPerSlide}
        imageCreditCost={imageCreditCost}
      />
    </div>
  );
}
