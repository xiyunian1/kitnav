import { FileText, ImageIcon, Search } from "lucide-react";
import type { MaterialType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MaterialCard } from "@/components/materials/material-card";
import { MaterialUploadForm } from "@/components/materials/material-upload-form";
import { PromptMaterialForm } from "@/components/materials/prompt-material-form";

export const metadata = { title: "我的素材库" };

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const session = await auth();
  const userId = session!.user.id;
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const type =
    params.type === "IMAGE" || params.type === "PROMPT" || params.type === "VIDEO"
      ? params.type
      : "ALL";
  const typeWhere: MaterialType | { in: MaterialType[] } =
    type === "ALL"
      ? { in: ["IMAGE", "PROMPT"] }
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

  const [mine, favorites] = await Promise.all([
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
  ]);

  const mineItems = mine.map((material) => serializeMaterial(material, userId));
  const favoriteItems = favorites.map((material) => serializeMaterial(material, userId));

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
          <PromptMaterialForm />
          <MaterialUploadForm />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          ["ALL", "全部"],
          ["IMAGE", "图片素材"],
          ["PROMPT", "提示词"],
          ["VIDEO", "视频素材"],
        ].map(([value, label]) => (
          <a
            key={value}
            href={`/library?type=${value}${querySuffix}`}
            className={`rounded-full border px-3 py-1 text-sm ${
              type === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {label}
          </a>
        ))}
      </div>

      {type === "VIDEO" ? (
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
          <ImageIcon className="size-12 opacity-40" />
          <p>视频素材模块已预留，待接入上传和封面后开放</p>
        </Card>
      ) : (
      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">我的素材</TabsTrigger>
          <TabsTrigger value="favorites">收藏素材</TabsTrigger>
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {mineItems.length === 0 ? (
            <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
              {type === "PROMPT" ? (
                <FileText className="size-12 opacity-40" />
              ) : (
                <ImageIcon className="size-12 opacity-40" />
              )}
              <p>还没有自己的素材</p>
            </Card>
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
            <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
              {type === "PROMPT" ? (
                <FileText className="size-12 opacity-40" />
              ) : (
                <ImageIcon className="size-12 opacity-40" />
              )}
              <p>还没有收藏素材</p>
            </Card>
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
