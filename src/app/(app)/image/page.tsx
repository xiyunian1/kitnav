import { auth } from "@/lib/auth";
import { getSettingNumber } from "@/lib/credits";
import { SETTING_KEYS } from "@/lib/settings-config";
import { prisma } from "@/lib/db";
import { resolveBillingMode } from "@/lib/providers";
import { serializeMaterial } from "@/lib/materials";
import { ImageWorkbench } from "./components/workbench";

export const metadata = { title: "图片生成" };

async function getAccessibleImageMaterial(materialId: string | undefined, userId: string) {
  if (!materialId) return null;

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      type: "IMAGE",
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

async function getAccessiblePromptMaterial(materialId: string | undefined, userId: string) {
  if (!materialId) return null;

  const material = await prisma.material.findFirst({
    where: {
      id: materialId,
      type: "PROMPT",
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
  }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const params = await searchParams;
  const promptMaterial = await getAccessiblePromptMaterial(params.promptMaterialId, userId);
  const imageMaterial = await getAccessibleImageMaterial(params.materialId, userId);
  const promptMeta = promptMaterial?.promptMeta || {};
  const initialPrompt =
    promptMaterial?.promptText?.trim().slice(0, 4000) ||
    params.prompt?.trim().slice(0, 4000) ||
    "";
  const initialMode =
    params.mode === "edit" || promptMeta.mode === "edit" || imageMaterial
      ? "edit"
      : "generate";
  const initialRatio =
    (typeof promptMeta.ratio === "string" ? promptMeta.ratio : undefined) ||
    params.ratio ||
    undefined;

  const [unitCost, user, billing] = await Promise.all([
    getSettingNumber(SETTING_KEYS.IMAGE_CREDIT_COST),
    prisma.user.findUnique({ where: { id: userId }, select: { credits: true } }),
    resolveBillingMode(userId, "IMAGE"),
  ]);

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-0 flex-col gap-4 overflow-hidden sm:h-[calc(100dvh-7rem)] lg:h-[calc(100dvh-8rem)]">
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">图片创作工作台</h1>
          <p className="text-muted-foreground">会话式创作，支持文生图与图生图</p>
        </div>
        <div className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground">
          {billing.useOwnKey ? "我的 API · 不消耗积分" : `平台模型 · ${unitCost} 积分/张`}
        </div>
      </div>
      <ImageWorkbench
        unitCost={unitCost}
        credits={user?.credits ?? 0}
        useOwnKey={billing.useOwnKey}
        defaultModel={billing.defaultModel}
        models={billing.models}
        initialPrompt={initialPrompt}
        initialMode={initialMode}
        initialRatio={initialRatio}
        initialImageMaterial={imageMaterial}
        initialPromptMaterial={promptMaterial}
      />
    </div>
  );
}
