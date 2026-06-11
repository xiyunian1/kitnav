import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "用户详情" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      creditTransactions: { orderBy: { createdAt: "desc" }, take: 30 },
      orders: { orderBy: { createdAt: "desc" }, take: 20 },
      generations: { orderBy: { createdAt: "desc" }, take: 30 },
      materials: { orderBy: { createdAt: "desc" }, take: 20 },
      registrationEvents: { orderBy: { createdAt: "desc" }, take: 10 },
      _count: { select: { generations: true, materials: true, orders: true } },
    },
  });
  if (!user) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{user.name || user.email}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/users">返回用户列表</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card><CardContent className="py-5"><p className="text-sm text-muted-foreground">积分</p><p className="text-2xl font-bold">{user.credits}</p></CardContent></Card>
        <Card><CardContent className="py-5"><p className="text-sm text-muted-foreground">生成数</p><p className="text-2xl font-bold">{user._count.generations}</p></CardContent></Card>
        <Card><CardContent className="py-5"><p className="text-sm text-muted-foreground">订单数</p><p className="text-2xl font-bold">{user._count.orders}</p></CardContent></Card>
        <Card><CardContent className="py-5"><p className="text-sm text-muted-foreground">素材数</p><p className="text-2xl font-bold">{user._count.materials}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">账号信息</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div>角色：<Badge>{user.role === "ADMIN" ? "管理员" : "用户"}</Badge></div>
          <div>状态：<Badge variant={user.status === "BANNED" ? "destructive" : "outline"}>{user.status === "BANNED" ? "已封禁" : "正常"}</Badge></div>
          <div>注册时间：{user.createdAt.toLocaleString("zh-CN")}</div>
          <div>更新时间：{user.updatedAt.toLocaleString("zh-CN")}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">积分流水</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>类型</TableHead><TableHead>说明</TableHead><TableHead className="text-right">变动</TableHead><TableHead className="text-right">余额</TableHead><TableHead>时间</TableHead></TableRow></TableHeader>
            <TableBody>
              {user.creditTransactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell>{tx.type}</TableCell>
                  <TableCell className="max-w-md truncate">{tx.description || "-"}</TableCell>
                  <TableCell className="text-right">{tx.amount > 0 ? "+" : ""}{tx.amount}</TableCell>
                  <TableCell className="text-right">{tx.balanceAfter}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{tx.createdAt.toLocaleString("zh-CN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">最近订单</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {user.orders.map((o) => (
              <div key={o.id} className="flex justify-between text-sm">
                <span>{o.provider} · {o.credits} 积分</span>
                <span className="text-muted-foreground">¥{(o.amount / 100).toFixed(2)} · {o.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">注册来源</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {user.registrationEvents.map((event) => (
              <div key={event.id} className="flex justify-between text-sm">
                <span>{event.provider} {event.ip ? `· ${event.ip}` : ""}</span>
                <span className="text-muted-foreground">{event.createdAt.toLocaleString("zh-CN")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">最近生成</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {user.generations.map((g) => (
            <div key={g.id} className="flex justify-between gap-4 text-sm">
              <span className="truncate">{g.prompt}</span>
              <span className="shrink-0 text-muted-foreground">{g.module} · {g.status} · {g.createdAt.toLocaleString("zh-CN")}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
