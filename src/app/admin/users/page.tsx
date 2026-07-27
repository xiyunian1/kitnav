import Link from "next/link";
import type { Prisma, Role, UserStatus } from "@prisma/client";
import { Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatChinaDate } from "@/lib/date-format";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UserRowActions } from "@/components/admin/user-row-actions";

export const metadata = { title: "用户管理" };

const PAGE_SIZE = 30;

const ROLE_FILTERS = [
  ["ALL", "全部角色"],
  ["USER", "用户"],
  ["ADMIN", "管理员"],
  ["GUEST", "游客"],
] as const;

const STATUS_FILTERS = [
  ["ALL", "全部状态"],
  ["ACTIVE", "正常"],
  ["BANNED", "已封禁"],
] as const;

function makeQuery(next: {
  q?: string;
  role?: string;
  status?: string;
  page?: number;
}) {
  const q = new URLSearchParams();
  if (next.q) q.set("q", next.q);
  if (next.role && next.role !== "ALL") q.set("role", next.role);
  if (next.status && next.status !== "ALL") q.set("status", next.status);
  if (next.page && next.page > 1) q.set("page", String(next.page));
  const query = q.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const role = ROLE_FILTERS.some(([value]) => value === params.role)
    ? params.role!
    : "ALL";
  const status = STATUS_FILTERS.some(([value]) => value === params.status)
    ? params.status!
    : "ALL";
  const page = Math.max(1, Number(params.page) || 1);

  const where: Prisma.UserWhereInput = {
    ...(q
      ? {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
          ],
        }
      : {}),
    ...(role === "ALL" ? {} : { role: role as Role }),
    ...(status === "ALL" ? {} : { status: status as UserStatus }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { generations: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">用户管理</h1>
          <p className="text-muted-foreground">
            共 {total} 名用户，当前第 {page} / {totalPages} 页
          </p>
        </div>
        <form className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          {role !== "ALL" && <input type="hidden" name="role" value={role} />}
          {status !== "ALL" && <input type="hidden" name="status" value={status} />}
          <Input name="q" defaultValue={q} className="pl-9" placeholder="搜索邮箱或昵称" />
        </form>
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
              <Link href={makeQuery({ q, role, status: value })}>{label}</Link>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLE_FILTERS.map(([value, label]) => (
            <Button
              key={value}
              asChild
              size="sm"
              variant={role === value ? "secondary" : "outline"}
            >
              <Link href={makeQuery({ q, role: value, status })}>{label}</Link>
            </Button>
          ))}
        </div>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">积分</TableHead>
              <TableHead className="text-right">生成数</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  暂无匹配用户
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.name || "—"}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>
                      {u.role === "ADMIN"
                        ? "管理员"
                        : u.role === "GUEST"
                          ? "游客"
                          : "用户"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.status === "BANNED" ? "destructive" : "outline"}
                    >
                      {u.status === "BANNED" ? "已封禁" : "正常"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {u.credits}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {u._count.generations}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatChinaDate(u.createdAt)}
                  </TableCell>
                  <TableCell>
                    <UserRowActions
                      user={{ id: u.id, role: u.role, status: u.status }}
                    />
                  </TableCell>
                </TableRow>
              ))
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
            <Link href={makeQuery({ q, role, status, page: page - 1 })}>
              上一页
            </Link>
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
            <Link href={makeQuery({ q, role, status, page: page + 1 })}>
              下一页
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
