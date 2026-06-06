import { getAllSettings } from "@/lib/credits";
import { SETTING_META } from "@/lib/settings-config";
import { listRechargePackages } from "@/lib/recharge-packages";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettingsForm } from "@/components/admin/settings-form";
import { RechargePackageForm } from "@/components/admin/recharge-package-form";
import { InviteCodeForm, InviteToggle } from "@/components/admin/invite-code-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "运营控制" };

const OPERATION_GROUPS = new Set(["基础", "注册", "积分", "图片"]);

export default async function AdminOperationsPage() {
  const [settings, packages, invites] = await Promise.all([
    getAllSettings(),
    listRechargePackages(true),
    prisma.inviteCode.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const operationMeta = SETTING_META.filter((meta) => OPERATION_GROUPS.has(meta.group ?? ""));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">运营控制</h1>
        <p className="text-muted-foreground">集中管理注册、充值、生成和风控开关</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">核心开关</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm values={settings} meta={operationMeta} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">充值套餐</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {packages.map((pkg) => (
            <RechargePackageForm key={pkg.id} pkg={pkg} />
          ))}
          <RechargePackageForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">邀请码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InviteCodeForm />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邀请码</TableHead>
                <TableHead>使用</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>备注</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => (
                <TableRow key={invite.id}>
                  <TableCell className="font-mono text-sm">{invite.code}</TableCell>
                  <TableCell>{invite.usedCount} / {invite.maxUses}</TableCell>
                  <TableCell className="flex items-center gap-2">
                    <InviteToggle id={invite.id} enabled={invite.enabled} />
                    <Badge variant={invite.enabled ? "default" : "outline"}>
                      {invite.enabled ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{invite.note || "-"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {invite.createdAt.toLocaleString("zh-CN")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
