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
import { Card, CardContent } from "@/components/ui/card";
import { OrderActions } from "@/components/admin/order-actions";

export const metadata = { title: "充值订单" };

const STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  PAID: { label: "已支付", variant: "default" },
  PENDING: { label: "待支付", variant: "secondary" },
  FAILED: { label: "失败", variant: "destructive" },
  REFUNDED: { label: "已退款", variant: "secondary" },
  CANCELED: { label: "已取消", variant: "secondary" },
};

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { email: true } } },
  });

  const revenue = orders
    .filter((o) => o.status === "PAID")
    .reduce((sum, o) => sum + o.amount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">充值订单</h1>
        <p className="text-muted-foreground">全站最近 100 笔订单</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-2 py-5">
          <span className="text-sm text-muted-foreground">累计收入</span>
          <span className="text-2xl font-bold">
            ¥{(revenue / 100).toFixed(2)}
          </span>
        </CardContent>
      </Card>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>用户</TableHead>
              <TableHead className="text-right">积分</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>渠道</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-muted-foreground"
                >
                  暂无订单
                </TableCell>
              </TableRow>
            ) : (
              orders.map((o) => {
                const s = STATUS[o.status];
                return (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">
                      {o.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-sm">{o.user.email}</TableCell>
                    <TableCell className="text-right">{o.credits}</TableCell>
                    <TableCell className="text-right">
                      ¥{(o.amount / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {o.provider}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {o.createdAt.toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-right">
                      <OrderActions id={o.id} status={o.status} />
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
