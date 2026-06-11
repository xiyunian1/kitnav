import { FileText, ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { EmptyState } from "@/components/empty-state";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { Input } from "@/components/ui/input";
import { MaterialCard } from "@/components/materials/material-card";
import { cn } from "@/lib/utils";
import { requireModulePageAccess } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";

export const metadata = { title: "素材广场" };

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
  const tabClass = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">素材广场</h1>
          <p className="text-muted-foreground">浏览平台官方和用户公开分享的素材</p>
        </div>
        <form className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} className="pl-9" placeholder="搜索素材、标签、描述" />
        </form>
      </div>

      <div className="flex gap-2">
        <Link
          href="/materials?type=IMAGE"
          className={tabClass(type === "IMAGE")}
        >
          图片素材
        </Link>
        <Link
          href="/materials?type=VIDEO"
          className={tabClass(type === "VIDEO")}
        >
          视频素材
        </Link>
        <Link
          href="/materials?type=PROMPT"
          className={tabClass(type === "PROMPT")}
        >
          提示词
        </Link>
      </div>

      {type === "VIDEO" ? (
        <EmptyState
          icon={ImageIcon}
          title="视频素材"
          description="视频素材模块已预留，待接入转码和封面后开放"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={type === "PROMPT" ? FileText : ImageIcon}
          title={type === "PROMPT" ? "暂无公开提示词" : "暂无公开图片素材"}
          description="成为第一个分享素材的人吧"
          action={{ label: "去我的素材库", href: "/library" }}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {items.map((material) => (
            <MaterialCard key={material.id} material={material} mode="square" />
          ))}
        </div>
      )}
    </div>
  );
}
