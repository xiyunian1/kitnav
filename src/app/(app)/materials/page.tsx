import { Suspense } from "react";
import { FileText, ImageIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { EmptyState } from "@/components/empty-state";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { MaterialCard } from "@/components/materials/material-card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireModulePageAccess } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { MaterialsToolbar } from "./materials-toolbar";

export const metadata = { title: "素材广场" };

async function MaterialGrid({
  q,
  type,
  userId,
}: {
  q: string;
  type: "IMAGE" | "VIDEO" | "PROMPT";
  userId: string;
}) {
  if (type === "VIDEO") {
    return (
      <EmptyState
        icon={ImageIcon}
        title="视频素材"
        description="视频素材模块已预留，待接入转码和封面后开放"
      />
    );
  }

  const materials = await prisma.material.findMany({
    where: {
      type,
      visibility: "PUBLIC",
      status: "APPROVED",
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { description: { contains: q } },
              { tags: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 80,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId } },
      likes: { where: { userId } },
      _count: { select: { favorites: true, likes: true } },
    },
  });
  const items = materials.map((material) => serializeMaterial(material, userId));

  if (items.length === 0) {
    return (
      <EmptyState
        icon={type === "PROMPT" ? FileText : ImageIcon}
        title={type === "PROMPT" ? "暂无公开提示词" : "暂无公开图片素材"}
        description="成为第一个分享素材的人吧"
        action={{ label: "去我的素材库", href: "/library" }}
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {items.map((material) => (
        <MaterialCard key={material.id} material={material} mode="square" />
      ))}
    </div>
  );
}

function MaterialGridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]" aria-label="正在加载素材">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border bg-card">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="space-y-2 p-2.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const session = await auth();
  const access = await requireModulePageAccess("materials");
  if (!access.usable) {
    return (
      <ModuleUnavailable
        name={access.name}
        message={access.message}
        status={access.status}
      />
    );
  }
  const userId = session!.user.id;
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const type = params.type === "VIDEO" || params.type === "PROMPT" ? params.type : "IMAGE";

  return (
    <div className="space-y-6">
      <MaterialsToolbar q={q} type={type}>
        <div>
          <h1 className="text-2xl font-bold">素材广场</h1>
          <p className="text-muted-foreground">浏览平台官方和用户公开分享的素材</p>
        </div>
      </MaterialsToolbar>

      <Suspense key={`${type}-${q}`} fallback={<MaterialGridSkeleton />}>
        <MaterialGrid q={q} type={type} userId={userId} />
      </Suspense>
    </div>
  );
}
