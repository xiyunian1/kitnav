import { FileText, ImageIcon, Search } from "lucide-react";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MaterialCard } from "@/components/materials/material-card";

export const metadata = { title: "素材广场" };

export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const session = await auth();
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
          className={`rounded-full border px-3 py-1 text-sm ${type === "IMAGE" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          图片素材
        </Link>
        <Link
          href="/materials?type=VIDEO"
          className={`rounded-full border px-3 py-1 text-sm ${type === "VIDEO" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          视频素材
        </Link>
        <Link
          href="/materials?type=PROMPT"
          className={`rounded-full border px-3 py-1 text-sm ${type === "PROMPT" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          提示词
        </Link>
      </div>

      {type === "VIDEO" ? (
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
          <ImageIcon className="size-12 opacity-40" />
          <p>视频素材模块已预留，待接入转码和封面后开放</p>
        </Card>
      ) : type === "PROMPT" && items.length === 0 ? (
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
          <FileText className="size-12 opacity-40" />
          <p>暂无公开提示词</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-muted-foreground">
          <ImageIcon className="size-12 opacity-40" />
          <p>暂无公开图片素材</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((material) => (
            <MaterialCard key={material.id} material={material} mode="square" />
          ))}
        </div>
      )}
    </div>
  );
}
