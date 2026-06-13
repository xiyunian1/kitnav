import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, FileText, ImageIcon, Layers, Tag, UserRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { serializeMaterial } from "@/lib/materials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MaterialCard } from "@/components/materials/material-card";
import { MaterialDetailActions } from "@/components/materials/material-detail-actions";
import { ModuleUnavailable } from "@/components/module-unavailable";
import { requireModulePageAccess } from "@/lib/module-controls";
import { isOptimizableImageUrl } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const material = await prisma.material.findFirst({
    where: { id, visibility: "PUBLIC", status: "APPROVED" },
    select: { title: true, description: true, promptText: true },
  });

  if (!material) return { title: "素材详情" };

  return {
    title: `${material.title} · 素材广场`,
    description: material.description || material.promptText?.slice(0, 120) || "素材广场详情",
  };
}

function typeLabel(type: string) {
  switch (type) {
    case "PROMPT":
      return "提示词";
    case "VIDEO":
      return "视频";
    case "AUDIO":
      return "音频";
    case "DOCUMENT":
      return "文档";
    default:
      return "图片";
  }
}

function formatSize(bytes: number | null) {
  if (!bytes) return "未知";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function MaterialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
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
  const { id } = await params;

  const material = await prisma.material.findFirst({
    where: { id, visibility: "PUBLIC", status: "APPROVED" },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId } },
      likes: { where: { userId } },
      _count: { select: { favorites: true, likes: true } },
    },
  });

  if (!material) notFound();

  const item = serializeMaterial(material, userId);
  const mode = item.promptMeta?.mode === "edit" ? "图生图" : "文生图";
  const ratio = typeof item.promptMeta?.ratio === "string" ? item.promptMeta.ratio : null;
  const model = typeof item.promptMeta?.model === "string" ? item.promptMeta.model : null;

  const relatedRaw = await prisma.material.findMany({
    where: {
      id: { not: item.id },
      type: item.type,
      visibility: "PUBLIC",
      status: "APPROVED",
      ...(item.tags.length
        ? {
            OR: item.tags.slice(0, 4).map((tag) => ({ tags: { contains: tag } })),
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 4,
    include: {
      owner: { select: { id: true, name: true, email: true } },
      favorites: { where: { userId } },
      likes: { where: { userId } },
      _count: { select: { favorites: true, likes: true } },
    },
  });
  const related = relatedRaw.map((m) => serializeMaterial(m, userId));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/materials?type=${item.type}`}>
          <ArrowLeft className="size-4" /> 返回素材广场
        </Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden p-0">
          {item.type === "IMAGE" ? (
            <div className="relative min-h-[360px] bg-muted lg:min-h-[620px]">
              <Image
                src={item.url}
                alt={item.title}
                fill
                unoptimized={!isOptimizableImageUrl(item.url)}
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-contain"
              />
            </div>
          ) : item.type === "PROMPT" ? (
            <div className="grid gap-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="flex min-h-[320px] items-center justify-center bg-muted">
                {item.thumbnailUrl ? (
                  <Image
                    src={item.thumbnailUrl}
                    alt={`${item.title} 参考图`}
                    width={900}
                    height={900}
                    unoptimized={!isOptimizableImageUrl(item.thumbnailUrl)}
                    className="max-h-[560px] w-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <FileText className="size-12 opacity-50" />
                    <span>无参考图</span>
                  </div>
                )}
              </div>
              <div className="min-h-[320px] border-t p-5 lg:border-l lg:border-t-0">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <span className="text-sm font-medium">提示词全文</span>
                </div>
                <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-4 text-sm leading-6">
                  {item.promptText}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <Layers className="size-12 opacity-50" />
              <p>暂不支持预览该类型素材</p>
            </div>
          )}
        </Card>

        <aside className="space-y-4">
          <Card className="gap-4 p-5">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge>{typeLabel(item.type)}</Badge>
                {item.ownerType === "PLATFORM" && <Badge variant="secondary">官方</Badge>}
                {item.type === "PROMPT" && <Badge variant="outline">{mode}</Badge>}
              </div>
              <h1 className="text-2xl font-bold leading-tight">{item.title}</h1>
              {item.description && (
                <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
              )}
            </div>

            <MaterialDetailActions material={item} />
          </Card>

          <Card className="gap-4 p-5">
            <h2 className="text-sm font-semibold">素材信息</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <UserRound className="size-4" /> 作者
                </dt>
                <dd className="truncate text-right">{item.ownerName}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="size-4" /> 发布时间
                </dt>
                <dd>{new Date(item.createdAt).toLocaleDateString("zh-CN")}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <ImageIcon className="size-4" /> 文件
                </dt>
                <dd>{formatSize(item.sizeBytes)}</dd>
              </div>
              {ratio && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">推荐比例</dt>
                  <dd>{ratio}</dd>
                </div>
              )}
              {model && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">模型</dt>
                  <dd className="max-w-44 truncate">{model}</dd>
                </div>
              )}
            </dl>

            {item.tags.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Tag className="size-4" /> 标签
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <Link key={tag} href={`/materials?type=${item.type}&q=${encodeURIComponent(tag)}`}>
                      <Badge variant="outline" className="cursor-pointer">
                        {tag}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {related.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">相似素材</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/materials?type=${item.type}`}>查看更多</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((material) => (
              <MaterialCard key={material.id} material={material} mode="square" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
