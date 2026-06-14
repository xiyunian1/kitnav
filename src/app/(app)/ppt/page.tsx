import { auth } from "@/lib/auth";
import { requireModulePageAccess, getStaticModuleMeta } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { prisma } from "@/lib/db";
import { resolvePptAgentBillingMode } from "@/lib/ppt-agent/billing";
import { isPptStylePrompt, type PptStyleMaterialOption } from "@/lib/ppt-agent/styles";
import { parsePromptMeta, parseTags } from "@/lib/materials";
import { PptWorkbench } from "./components/workbench";

export const metadata = { title: "PPT 生成" };

export default async function PptPage({
  searchParams,
}: {
  searchParams: Promise<{ styleMaterialId?: string }>;
}) {
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

  const params = await searchParams;
  const selectedStyleMaterialId = params.styleMaterialId?.trim() || "";

  const [recentProjects, billingMode, rawStyleMaterials] = await Promise.all([
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
        slideCount: true,
        createdAt: true,
        completedAt: true,
        pptxPath: true,
      },
    }),
    resolvePptAgentBillingMode(session!.user.id),
    prisma.material.findMany({
      where: {
        type: "PROMPT",
        OR: [
          { ownerId: session!.user.id },
          {
            visibility: "PUBLIC",
            status: "APPROVED",
            favorites: { some: { userId: session!.user.id } },
          },
          ...(selectedStyleMaterialId
            ? [
                {
                  id: selectedStyleMaterialId,
                  visibility: "PUBLIC" as const,
                  status: "APPROVED" as const,
                },
              ]
            : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        favorites: { where: { userId: session!.user.id } },
      },
    }),
  ]);
  const styleMaterials: PptStyleMaterialOption[] = rawStyleMaterials
    .filter((material) => isPptStylePrompt(parsePromptMeta(material.promptMeta), parseTags(material.tags)))
    .filter((material) => Boolean(material.promptText))
    .map((material) => ({
      id: material.id,
      title: material.title,
      description: material.description,
      promptText: material.promptText || "",
      ownerName:
        material.ownerType === "PLATFORM"
          ? "平台官方"
          : material.owner?.name || material.owner?.email || "用户",
      source:
        material.ownerId === session!.user.id
          ? "mine"
          : material.favorites.length > 0
            ? "favorite"
            : "public",
    }));

  const creditsPerSlide = Number(process.env.PPT_CREDITS_PER_SLIDE || 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">PPT 生成</h1>
        <p className="text-muted-foreground">
          基于 PPT Master 的多阶段生成流程，从主题或结构化内容生成可下载的 PowerPoint。
        </p>
      </div>

      <PptWorkbench
        recentProjects={recentProjects}
        useOwnKey={billingMode.useOwnKey}
        creditsPerSlide={creditsPerSlide}
        styleMaterials={styleMaterials}
        initialStyleMaterialId={selectedStyleMaterialId}
      />
    </div>
  );
}
