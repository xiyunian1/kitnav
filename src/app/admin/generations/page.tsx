import Link from "next/link";
import type { GenerationStatus, ModuleType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GenerationCleanupButton } from "@/components/admin/generation-cleanup-button";

export const metadata = { title: "生成记录" };

const MODULE_LABEL: Record<string, string> = {
  IMAGE: "图片",
  VIDEO: "视频",
};
const SUPPORTED_GENERATION_MODULES: ModuleType[] = ["IMAGE", "VIDEO"];

const STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  SUCCESS: { label: "成功", variant: "default" },
  PENDING: { label: "处理中", variant: "secondary" },
  FAILED: { label: "失败", variant: "destructive" },
};

const STATUS_FILTERS = [
  ["ALL", "全部"],
  ["SUCCESS", "成功"],
  ["FAILED", "失败"],
  ["PENDING", "处理中"],
] as const;

function formatDuration(durationMs: number | null) {
  if (!durationMs) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${Math.round(durationMs / 1000)}s`;
}

function queryFor(next: { status?: string; upstreamStatus?: string }) {
  const q = new URLSearchParams();
  if (next.status && next.status !== "ALL") q.set("status", next.status);
  if (next.upstreamStatus) q.set("upstreamStatus", next.upstreamStatus);
  const query = q.toString();
  return query ? `/admin/generations?${query}` : "/admin/generations";
}

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; upstreamStatus?: string }>;
}) {
  const params = await searchParams;
  const status = STATUS_FILTERS.some(([value]) => value === params.status)
    ? params.status!
    : "ALL";
  const upstreamStatus = params.upstreamStatus?.trim();
  const where: Prisma.GenerationWhereInput = {
    module: { in: SUPPORTED_GENERATION_MODULES },
    ...(status === "ALL" ? {} : { status: status as GenerationStatus }),
    ...(upstreamStatus && /^\d+$/.test(upstreamStatus)
      ? { upstreamStatus: Number(upstreamStatus) }
      : {}),
  };

  const since = new Date();
  since.setDate(since.getDate() - 7);
  const [generations, total, failed7d, pending, upstream524] = await Promise.all([
    prisma.generation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { email: true } } },
    }),
    prisma.generation.count({ where }),
    prisma.generation.count({
      where: { module: { in: SUPPORTED_GENERATION_MODULES }, createdAt: { gte: since }, status: "FAILED" },
    }),
    prisma.imageTurn.count({ where: { status: "PENDING" } }),
    prisma.generation.count({
      where: { module: { in: SUPPORTED_GENERATION_MODULES }, createdAt: { gte: since }, upstreamStatus: 524 },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">生成记录</h1>
          <p className="text-muted-foreground">
            展示最近 100 条，当前筛选共 {total} 条
          </p>
        </div>
        <GenerationCleanupButton />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">处理中任务</p>
            <p className="text-2xl font-bold">{pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">7 日失败</p>
            <p className="text-2xl font-bold">{failed7d}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">7 日 524 超时</p>
            <p className="text-2xl font-bold">{upstream524}</p>
          </CardContent>
        </Card>
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
              <Link href={queryFor({ status: value, upstreamStatus })}>{label}</Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant={upstreamStatus === "524" ? "default" : "outline"}>
            <Link href={queryFor({ status, upstreamStatus: "524" })}>只看 524 超时</Link>
          </Button>
          {upstreamStatus && (
            <Button asChild size="sm" variant="ghost">
              <Link href={queryFor({ status })}>清除错误码</Link>
            </Button>
          )}
        </div>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>模块</TableHead>
              <TableHead>描述</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="hidden xl:table-cell">模型</TableHead>
              <TableHead className="hidden lg:table-cell">渠道</TableHead>
              <TableHead className="text-right">图片</TableHead>
              <TableHead className="text-right">耗时</TableHead>
              <TableHead className="text-right">消耗</TableHead>
              <TableHead>错误</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {generations.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="py-10 text-center text-muted-foreground"
                >
                  暂无生成记录
                </TableCell>
              </TableRow>
            ) : (
              generations.map((g) => {
                const s = STATUS[g.status];
                return (
                  <TableRow key={g.id}>
                    <TableCell className="text-sm">{g.user.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{MODULE_LABEL[g.module]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm" title={g.prompt}>
                      {g.prompt}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-36 truncate text-xs xl:table-cell">
                      {g.providerModel || "-"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <Badge variant={g.providerSource === "user" ? "secondary" : "outline"}>
                        {g.providerSource === "user" ? "用户 API" : "平台"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {g.successCount}/{g.imageCount}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {formatDuration(g.durationMs)}
                    </TableCell>
                    <TableCell className="text-right">{g.creditsCost}</TableCell>
                    <TableCell className="max-w-xs text-xs text-muted-foreground">
                      <div className="truncate" title={g.error || ""}>
                        {g.upstreamStatus ? `HTTP ${g.upstreamStatus} · ` : ""}
                        {g.error || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {g.createdAt.toLocaleString("zh-CN")}
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
