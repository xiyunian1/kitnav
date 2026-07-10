import { auth } from "@/lib/auth";
import { getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { prisma } from "@/lib/db";
import { getModuleModelOptions } from "@/lib/providers";
import type { ModelSource } from "@/lib/module-model-options";
import { serializeMaterial } from "@/lib/materials";
import { requireModulePageAccess, getStaticModuleMeta } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { ImageWorkbench } from "./components/workbench";

export const metadata = { title: "图片生成" };

async function getAccessibleMaterial(
  materialId: string | undefined,
  type: "IMAGE" | "PROMPT",
  userId: string
) {
  if (!materialId) return null;

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      type,
      OR: [
        { ownerId: userId },
        { visibility: "PUBLIC", status: "APPROVED" },
      ],
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId } },
      likes: { where: { userId } },
      _count: { select: { favorites: true, likes: true } },
    },
  });

  return material ? serializeMaterial(material, userId) : null;
}

export default async function ImagePage({
  searchParams,
}: {
  searchParams: Promise<{
    prompt?: string;
    mode?: string;
    ratio?: string;
    materialId?: string;
    promptMaterialId?: string;
    quality?: string;
    count?: string;
    model?: string;
    modelSource?: string;
  }>;
}) {
  const session = await auth();
  const access = await requireModulePageAccess("image");
  if (!access.usable) {
    const meta = getStaticModuleMeta("image");
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
        icon={meta?.icon}
      />
    );
  }
  const userId = session!.user.id;
  const params = await searchParams;
  const [promptMaterial, imageMaterial] = await Promise.all([
    getAccessibleMaterial(params.promptMaterialId, "PROMPT", userId),
    getAccessibleMaterial(params.materialId, "IMAGE", userId),
  ]);
  const promptMeta = promptMaterial?.promptMeta || {};
  const imageMeta = imageMaterial?.promptMeta || {};
  const initialPrompt =
    promptMaterial?.promptText?.trim().slice(0, 4000) ||
    imageMaterial?.promptText?.trim().slice(0, 4000) ||
    imageMaterial?.description?.trim().slice(0, 4000) ||
    params.prompt?.trim().slice(0, 4000) ||
    "";
  const initialMode =
    params.mode === "edit" || promptMeta.mode === "edit" || imageMaterial
      ? "edit"
      : "generate";
  const initialRatio =
    (typeof promptMeta.ratio === "string" ? promptMeta.ratio : undefined) ||
    (typeof imageMeta.ratio === "string" ? imageMeta.ratio : undefined) ||
    params.ratio ||
    undefined;
  const initialQuality =
    (typeof promptMeta.quality === "string" ? promptMeta.quality : undefined) ||
    (typeof imageMeta.quality === "string" ? imageMeta.quality : undefined) ||
    params.quality ||
    undefined;
  const initialCount =
    typeof promptMeta.count === "number" && Number.isFinite(promptMeta.count)
      ? promptMeta.count
      : typeof imageMeta.count === "number" && Number.isFinite(imageMeta.count)
        ? imageMeta.count
      : params.count && /^\d+$/.test(params.count)
        ? Number(params.count)
        : undefined;
  const initialModel =
    (typeof promptMeta.model === "string" ? promptMeta.model : undefined) ||
    (typeof imageMeta.model === "string" ? imageMeta.model : undefined) ||
    params.model ||
    undefined;
  const rawInitialModelSource =
    (typeof promptMeta.modelSource === "string" ? promptMeta.modelSource : undefined) ||
    (typeof imageMeta.modelSource === "string" ? imageMeta.modelSource : undefined) ||
    params.modelSource;
  const initialModelSource: ModelSource | undefined =
    rawInitialModelSource === "user" || rawInitialModelSource === "platform"
      ? rawInitialModelSource
      : undefined;

  const [unitCost, user, modelOptions] = await Promise.all([
    getSettingNumber(SETTING_KEYS.IMAGE_CREDIT_COST),
    prisma.user.findUnique({ where: { id: userId }, select: { credits: true } }),
    getModuleModelOptions(userId, "IMAGE"),
  ]);
  const sourceSummary = [
    modelOptions.some((option) => option.source === "user") ? "我的 API" : "",
    modelOptions.some((option) => option.source === "platform") ? "平台模型" : "",
  ].filter(Boolean).join(" / ");

  return (
    <div className="flex min-h-[calc(100dvh-6rem)] flex-col gap-4 sm:min-h-[calc(100dvh-7rem)] md:h-[calc(100dvh-7rem)] md:min-h-0 md:overflow-hidden lg:h-[calc(100dvh-8rem)]">
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">图片创作工作台</h1>
          <p className="text-muted-foreground">会话式创作，支持文生图与图生图</p>
        </div>
        <div className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
          {sourceSummary || "暂无可用模型"}
        </div>
      </div>
      <ImageWorkbench
        unitCost={unitCost}
        credits={user?.credits ?? 0}
        modelOptions={modelOptions}
        initialPrompt={initialPrompt}
        initialMode={initialMode}
        initialRatio={initialRatio}
        initialQuality={initialQuality}
        initialCount={initialCount}
        initialModel={initialModel}
        initialModelSource={initialModelSource}
        initialImageMaterial={imageMaterial}
        initialPromptMaterial={promptMaterial}
      />
    </div>
  );
}
