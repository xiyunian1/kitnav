import Link from "next/link";
import type { PptProjectStatus, Prisma } from "@prisma/client";
import { Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatChinaDateTime } from "@/lib/date-format";
import { resolvePptConfirmationTiming } from "@/lib/ppt-agent/timing";
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
import { Input } from "@/components/ui/input";
import {
  PPT_COMPLETED_STATUSES,
  PPT_PROCESSING_STATUSES,
} from "@/lib/ppt-agent/status";

export const metadata = { title: "PPT 记录" };

const PAGE_SIZE = 30;

const STATUS_FILTERS = [
  ["ALL", "全部"],
  ["QUEUED", "排队中"],
  ["PENDING", "等待中"],
  ["STRATEGIZING", "规划中"],
  ["AWAITING_CONFIRMATION", "等待确认"],
  ["ACQUIRING_IMAGES", "采集素材"],
  ["EXECUTING", "生成中"],
  ["EXPORTING", "导出中"],
  ["COMPLETED", "已完成"],
  ["FAILED", "失败"],
] as const;

const ACTIVE_STATUSES: PptProjectStatus[] = [...PPT_PROCESSING_STATUSES];

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "草稿", variant: "outline" },
  PENDING: { label: "等待中", variant: "secondary" },
  QUEUED: { label: "排队中", variant: "secondary" },
  GENERATING: { label: "生成中", variant: "secondary" },
  STRATEGIZING: { label: "规划中", variant: "secondary" },
  AWAITING_CONFIRMATION: { label: "等待确认", variant: "secondary" },
  ACQUIRING_IMAGES: { label: "采集素材", variant: "secondary" },
  EXECUTING: { label: "生成中", variant: "secondary" },
  EXPORTING: { label: "导出中", variant: "secondary" },
  READY: { label: "已完成", variant: "default" },
  COMPLETED: { label: "已完成", variant: "default" },
  FAILED: { label: "失败", variant: "destructive" },
};

function makeQuery(next: { q?: string; status?: string; page?: number }) {
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.status && next.status !== "ALL") params.set("status", next.status);
  if (next.page && next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/admin/ppt-projects?${query}` : "/admin/ppt-projects";
}

function formatDuration(
  start: Date,
  end: Date | null,
  confirmationWaitDurationMs: number,
  confirmationWaitStartedAt: Date | null,
) {
  if (!end) return "-";
  const openWaitMs = confirmationWaitStartedAt
    ? Math.max(0, end.getTime() - confirmationWaitStartedAt.getTime())
    : 0;
  const seconds = Math.max(
    0,
    Math.round(
      (end.getTime() -
        start.getTime() -
        confirmationWaitDurationMs -
        openWaitMs) /
        1000,
    ),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function sourceTypeLabel(value: string) {
  if (value === "TOPIC") return "主题";
  if (value === "MARKDOWN") return "Markdown";
  if (value === "URL") return "网页";
  if (value === "DOCUMENT") return "文档";
  return value;
}

function statusLabel(status: string) {
  return STATUS_META[status]?.label || status;
}

export default async function AdminPptProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = STATUS_FILTERS.some(([value]) => value === params.status)
    ? params.status!
    : "ALL";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.PptProjectWhereInput = {
    ...(q
      ? {
          OR: [
            { title: { contains: q } },
            { error: { contains: q } },
            { user: { email: { contains: q } } },
            { user: { name: { contains: q } } },
          ],
        }
      : {}),
    ...(status === "ALL"
      ? {}
      : status === "COMPLETED"
        ? { status: { in: [...PPT_COMPLETED_STATUSES] } }
        : status === "EXECUTING"
          ? { status: { in: ["EXECUTING", "GENERATING"] } }
          : { status: status as PptProjectStatus }),
  };

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const [projects, total, activeCount, failed7d, completed7d] = await Promise.all([
    prisma.pptProject.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.pptProject.count({ where }),
    prisma.pptProject.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    prisma.pptProject.count({
      where: { status: "FAILED", createdAt: { gte: since } },
    }),
    prisma.pptProject.count({
      where: {
        status: { in: [...PPT_COMPLETED_STATUSES] },
        createdAt: { gte: since },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">PPT 记录</h1>
          <p className="text-muted-foreground">
            展示所有用户的 PPT 生成任务，共 {total} 条，当前第 {page} / {totalPages} 页
          </p>
        </div>
        <form className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          {status !== "ALL" && <input type="hidden" name="status" value={status} />}
          <Input
            name="q"
            defaultValue={q}
            className="pl-9"
            placeholder="搜索标题、用户、错误信息"
          />
        </form>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">当前处理中</p>
            <p className="text-2xl font-bold">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">7 日完成</p>
            <p className="text-2xl font-bold">{completed7d}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">7 日失败</p>
            <p className="text-2xl font-bold">{failed7d}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(([value, label]) => (
          <Button
            key={value}
            asChild
            size="sm"
            variant={status === value ? "default" : "outline"}
          >
            <Link href={makeQuery({ q, status: value })}>{label}</Link>
          </Button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">进度</TableHead>
              <TableHead>阶段</TableHead>
              <TableHead className="text-right">页数</TableHead>
              <TableHead>来源</TableHead>
              <TableHead className="text-right">积分</TableHead>
              <TableHead>耗时</TableHead>
              <TableHead>错误</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-muted-foreground">
                  暂无 PPT 生成记录
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => {
                const meta = STATUS_META[project.status] || {
                  label: project.status,
                  variant: "outline" as const,
                };
                const confirmationTiming = resolvePptConfirmationTiming(project);
                return (
                  <TableRow key={project.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <Link
                          href={`/admin/users/${project.userId}`}
                          className="font-medium hover:underline"
                        >
                          {project.user.name || "—"}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {project.user.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <div className="truncate font-medium" title={project.title}>
                        {project.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {project.id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{project.progress}%</TableCell>
                    <TableCell className="max-w-44 truncate text-sm text-muted-foreground">
                      {project.currentPhase || statusLabel(project.status)}
                    </TableCell>
                    <TableCell className="text-right">{project.slideCount ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{sourceTypeLabel(project.sourceType)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{project.creditsCost}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDuration(
                        project.createdAt,
                        project.completedAt,
                        confirmationTiming.confirmationWaitDurationMs,
                        confirmationTiming.confirmationWaitStartedAt,
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 text-xs text-muted-foreground">
                      <div className="truncate" title={project.error || ""}>
                        {project.error || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatChinaDateTime(project.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/ppt-projects/${project.id}`}>查看</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {page <= 1 ? (
          <Button variant="outline" size="sm" disabled>
            上一页
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={makeQuery({ q, status, page: page - 1 })}>上一页</Link>
          </Button>
        )}
        <span className="px-2 text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        {page >= totalPages ? (
          <Button variant="outline" size="sm" disabled>
            下一页
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href={makeQuery({ q, status, page: page + 1 })}>下一页</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
