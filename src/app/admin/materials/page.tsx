import Image from "next/image";
import Link from "next/link";
import type { MaterialStatus, MaterialType } from "@prisma/client";
import { FileText } from "lucide-react";
import { prisma } from "@/lib/db";
import { parseTags } from "@/lib/materials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MaterialReviewActions } from "@/components/admin/material-review-actions";

export const metadata = { title: "素材管理" };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "私有", variant: "outline" },
  PENDING_REVIEW: { label: "待审核", variant: "secondary" },
  APPROVED: { label: "已公开", variant: "default" },
  REJECTED: { label: "未通过", variant: "destructive" },
  ARCHIVED: { label: "已下架", variant: "outline" },
};

const STATUS_FILTERS = [
  ["ALL", "全部"],
  ["PENDING_REVIEW", "待审核"],
  ["APPROVED", "已公开"],
  ["REJECTED", "未通过"],
  ["ARCHIVED", "已下架"],
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number][0];
type TypeFilter = (typeof TYPE_FILTERS)[number][0];

const TYPE_FILTERS = [
  ["ALL", "全部类型"],
  ["IMAGE", "图片"],
  ["PROMPT", "提示词"],
] as const;

export default async function AdminMaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; reports?: string }>;
}) {
  const params = await searchParams;
  const status: StatusFilter = STATUS_FILTERS.some(([value]) => value === params.status)
    ? (params.status as StatusFilter)
    : "PENDING_REVIEW";
  const type: TypeFilter = TYPE_FILTERS.some(([value]) => value === params.type)
    ? (params.type as TypeFilter)
    : "ALL";
  const reportsOnly = params.reports === "open";
  const queryFor = (next: { status?: string; type?: string; reports?: boolean }) => {
    const q = new URLSearchParams();
    q.set("status", next.status ?? status);
    q.set("type", next.type ?? type);
    const nextReports = "reports" in next ? next.reports : reportsOnly;
    if (nextReports) q.set("reports", "open");
    return `/admin/materials?${q.toString()}`;
  };

  const materials = await prisma.material.findMany({
    where: {
      type: type === "ALL" ? { in: ["IMAGE", "PROMPT"] satisfies MaterialType[] } : type,
      status: status === "ALL" ? { not: "DRAFT" as MaterialStatus } : status,
      ...(reportsOnly ? { reports: { some: { status: "OPEN" as const } } } : {}),
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      owner: { select: { email: true, name: true } },
      _count: { select: { favorites: true, likes: true, reports: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">素材管理</h1>
        <p className="text-muted-foreground">审核用户分享素材，管理公开素材状态</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(([value, label]) => (
            <Button
              key={value}
              asChild
              size="sm"
              variant={status === value ? "default" : "outline"}
            >
              <Link href={queryFor({ status: value })}>{label}</Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            size="sm"
            variant={reportsOnly ? "default" : "outline"}
          >
            <Link href={queryFor({ reports: !reportsOnly })}>
              {reportsOnly ? "查看全部举报" : "只看有举报"}
            </Link>
          </Button>
          {TYPE_FILTERS.map(([value, label]) => (
            <Button
              key={value}
              asChild
              size="sm"
              variant={type === value ? "secondary" : "outline"}
            >
              <Link href={queryFor({ type: value })}>{label}</Link>
            </Button>
          ))}
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>素材</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">点赞</TableHead>
              <TableHead className="text-right">收藏</TableHead>
              <TableHead className="text-right">举报</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {materials.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  暂无待处理素材
                </TableCell>
              </TableRow>
            ) : (
              materials.map((material) => {
                const status = STATUS[material.status];
                const tags = parseTags(material.tags);
                return (
                  <TableRow key={material.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="relative flex size-14 items-center justify-center overflow-hidden rounded-md border bg-muted">
                          {material.type === "IMAGE" ? (
                            <Image
                              src={material.thumbnailUrl || material.url}
                              alt={material.title}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          ) : (
                            <FileText className="size-6 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{material.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {material.description || "无描述"}
                          </p>
                          {material.type === "PROMPT" && material.promptText && (
                            <p className="mt-1 line-clamp-2 max-w-md text-xs text-muted-foreground">
                              {material.promptText}
                            </p>
                          )}
                          {material.status === "REJECTED" && material.rejectionReason && (
                            <p className="mt-1 line-clamp-2 max-w-md text-xs text-destructive">
                              拒绝原因：{material.rejectionReason}
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {material.ownerType === "PLATFORM"
                        ? "平台官方"
                        : material.owner?.email || "未知用户"}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-48 flex-wrap gap-1">
                        {tags.length ? (
                          tags.slice(0, 4).map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">无</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{material._count.likes}</TableCell>
                    <TableCell className="text-right">{material._count.favorites}</TableCell>
                    <TableCell className="text-right">{material._count.reports}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {material.createdAt.toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <MaterialReviewActions
                        id={material.id}
                        status={material.status}
                        reportCount={material._count.reports}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
