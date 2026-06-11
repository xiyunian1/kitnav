import Image from "next/image";
import Link from "next/link";
import type { FeedbackModule, FeedbackStatus, FeedbackType, Prisma } from "@prisma/client";
import { MessageSquare } from "lucide-react";
import { prisma } from "@/lib/db";
import { parseScreenshotUrls } from "@/lib/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FeedbackActions } from "@/components/admin/feedback-actions";

export const metadata = { title: "用户反馈" };

const STATUS_LABEL: Record<FeedbackStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  NEW: { label: "未读", variant: "default" },
  IN_PROGRESS: { label: "处理中", variant: "secondary" },
  RESOLVED: { label: "已解决", variant: "outline" },
  CLOSED: { label: "已关闭", variant: "outline" },
};

const TYPE_LABEL: Record<FeedbackType, string> = {
  FEATURE: "功能建议",
  BUG: "Bug 问题",
  EXPERIENCE: "体验问题",
  BILLING: "充值问题",
  OTHER: "其他",
};

const MODULE_LABEL: Record<FeedbackModule, string> = {
  IMAGE: "图片生成",
  MATERIALS: "素材库",
  CREDITS: "积分充值",
  AUTH: "登录注册",
  PROFILE: "个人设置",
  OTHER: "其他",
};

const STATUS_FILTERS = [
  ["OPEN", "未处理"],
  ["ALL", "全部"],
  ["NEW", "未读"],
  ["IN_PROGRESS", "处理中"],
  ["RESOLVED", "已解决"],
  ["CLOSED", "已关闭"],
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number][0];

function queryFor(status: string) {
  return status === "OPEN" ? "/admin/feedback" : `/admin/feedback?status=${status}`;
}

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const status: StatusFilter = STATUS_FILTERS.some(([value]) => value === params.status)
    ? (params.status as StatusFilter)
    : "OPEN";

  const where: Prisma.FeedbackWhereInput =
    status === "ALL"
      ? {}
      : status === "OPEN"
        ? { status: { in: ["NEW", "IN_PROGRESS"] } }
        : { status: status as FeedbackStatus };

  const [items, openCount, todayCount] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { email: true, name: true } } },
    }),
    prisma.feedback.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } }),
    prisma.feedback.count({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">用户反馈</h1>
          <p className="text-muted-foreground">收集用户建议、问题和截图，跟进处理状态</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="flex size-11 items-center justify-center rounded-lg bg-muted">
              <MessageSquare className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">未处理反馈</p>
              <p className="text-2xl font-bold">{openCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground">今日反馈</p>
            <p className="text-2xl font-bold">{todayCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <p className="text-sm text-muted-foreground">当前列表</p>
            <p className="text-2xl font-bold">{items.length}</p>
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
            <Link href={queryFor(value)}>{label}</Link>
          </Button>
        ))}
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>反馈</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>截图</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="text-right">处理</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  暂无反馈
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const statusMeta = STATUS_LABEL[item.status];
                const screenshots = parseScreenshotUrls(item.screenshotUrls);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-80 max-w-xl">
                      <div className="space-y-1">
                        <p className="font-medium">{item.title}</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {item.content}
                        </p>
                        {item.pagePath && (
                          <p className="text-xs text-muted-foreground">页面：{item.pagePath}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col">
                        <span>{item.user.name || "用户"}</span>
                        <span className="text-xs text-muted-foreground">{item.user.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="secondary">{TYPE_LABEL[item.type]}</Badge>
                        <Badge variant="outline">{MODULE_LABEL[item.module]}</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {screenshots.length === 0 ? (
                        <span className="text-xs text-muted-foreground">无</span>
                      ) : (
                        <div className="flex gap-2">
                          {screenshots.map((url) => (
                            <Link
                              key={url}
                              href={url}
                              target="_blank"
                              className="relative block size-14 overflow-hidden rounded-md border bg-muted"
                            >
                              <Image src={url} alt="反馈截图" fill unoptimized className="object-cover" />
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.createdAt.toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <FeedbackActions id={item.id} status={item.status} adminNote={item.adminNote} />
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
