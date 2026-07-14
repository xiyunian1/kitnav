import Link from "next/link";
import { FileText, ImageIcon, Search, FolderOpen, Heart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import type { MaterialType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getMaterialStorageUsage,
  parsePromptMeta,
  parseTags,
  serializeMaterial,
} from "@/lib/materials";
import { isPptStylePrompt } from "@/lib/ppt-agent/styles";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialCard } from "@/components/materials/material-card";
import { MaterialUploadForm } from "@/components/materials/material-upload-form";
import { PromptMaterialForm } from "@/components/materials/prompt-material-form";
import { requireModulePageAccess } from "@/lib/module-controls";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { MaterialStorageUsageView } from "@/components/materials/material-storage-usage";

export const metadata = { title: "我的素材库" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const session = await auth();
  const access = await requireModulePageAccess("library");
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
  const type =
    params.type === "IMAGE" || params.type === "PROMPT" || params.type === "VIDEO" || params.type === "PPT_STYLE"
      ? params.type
      : "ALL";
  const typeWhere: MaterialType | { in: MaterialType[] } =
    type === "ALL"
      ? { in: ["IMAGE", "PROMPT"] }
      : type === "PPT_STYLE"
        ? "PROMPT"
      : type === "VIDEO"
        ? "VIDEO"
        : type;
  const querySuffix = q ? `&q=${encodeURIComponent(q)}` : "";

  const whereSearch = q
    ? {
        OR: [
          { title: { contains: q } },
          { description: { contains: q } },
          { tags: { contains: q } },
        ],
      }
    : {};

  const [mine, favorites, storageUsage] = await Promise.all([
    prisma.material.findMany({
      where: { ownerId: userId, type: typeWhere, ...whereSearch },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        favorites: { where: { userId } },
        likes: { where: { userId } },
        _count: { select: { favorites: true, likes: true } },
      },
    }),
    prisma.material.findMany({
      where: {
        type: typeWhere,
        visibility: "PUBLIC",
        status: "APPROVED",
        favorites: { some: { userId } },
        ...whereSearch,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        favorites: { where: { userId } },
        likes: { where: { userId } },
        _count: { select: { favorites: true, likes: true } },
      },
    }),
    getMaterialStorageUsage(userId),
  ]);

  const filterPromptKind = <T extends { type: MaterialType; promptMeta: string | null; tags: string | null }>(items: T[]) => {
    if (type === "PPT_STYLE") {
      return items.filter((material) => isPptStylePrompt(parsePromptMeta(material.promptMeta), parseTags(material.tags)));
    }
    if (type === "PROMPT") {
      return items.filter((material) => !isPptStylePrompt(parsePromptMeta(material.promptMeta), parseTags(material.tags)));
    }
    return items;
  };

  const mineItems = filterPromptKind(mine).map((material) => serializeMaterial(material, userId));
  const favoriteItems = filterPromptKind(favorites).map((material) => serializeMaterial(material, userId));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">我的素材库</h1>
          <p className="text-muted-foreground">管理上传、生成保存、提示词和收藏素材</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <form className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            {type !== "ALL" && <input type="hidden" name="type" value={type} />}
            <Input name="q" defaultValue={q} className="pl-9" placeholder="搜索我的素材" />
          </form>
          <PromptMaterialForm defaultModule={type === "PPT_STYLE" ? "PPT" : "IMAGE"} />
          <MaterialUploadForm />
        </div>
      </div>

      <MaterialStorageUsageView usage={storageUsage} />

      <div className="flex flex-wrap gap-2">
        {[
          ["ALL", "全部"],
          ["IMAGE", "图片素材"],
          ["PROMPT", "提示词"],
          ["PPT_STYLE", "PPT 风格"],
          ["VIDEO", "视频素材"],
        ].map(([value, label]) => (
          <Link
            key={value}
            href={`/library?type=${value}${querySuffix}`}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              type === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {type === "VIDEO" ? (
        <EmptyState
          icon={ImageIcon}
          title="视频素材"
          description="视频素材模块已预留，待接入上传和封面后开放"
        />
      ) : (
      <Tabs defaultValue="mine">
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="mine">我的素材</TabsTrigger>
          <TabsTrigger value="favorites">收藏素材</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {mineItems.length === 0 ? (
            <EmptyState
              icon={type === "PROMPT" ? FileText : FolderOpen}
              title="还没有自己的素材"
              description={
                type === "PPT_STYLE"
                  ? "新建 PPT 风格后，可以在 PPT 生成时直接选用"
                  : type === "PROMPT"
                    ? "保存常用提示词，随时复用"
                    : "上传图片或保存生成结果到素材库"
              }
              action={{ label: "浏览素材广场", href: "/materials" }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {mineItems.map((material) => (
                <MaterialCard key={material.id} material={material} mode="library" />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="favorites" className="mt-4">
          {favoriteItems.length === 0 ? (
            <EmptyState
              icon={Heart}
              title="还没有收藏素材"
              description="在素材广场中点击收藏，喜欢的素材会出现在这里"
              action={{ label: "去素材广场", href: "/materials" }}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {favoriteItems.map((material) => (
                <MaterialCard key={material.id} material={material} mode="square" />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
