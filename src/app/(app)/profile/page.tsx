import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForms } from "@/components/profile-forms";
import { Coins, ScanEye } from "lucide-react";
import { isGuestRole } from "@/lib/guest-mode";

export const metadata = { title: "个人资料" };

export default async function ProfilePage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
  });

  if (!user) return null;

  if (isGuestRole(user.role)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">个人资料</h1>
          <p className="text-muted-foreground">正式账号可在这里管理资料和密码</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-4 py-6">
            <span className="flex size-11 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-200">
              <ScanEye className="size-5" />
            </span>
            <div>
              <p className="font-medium">游客参观账号</p>
              <p className="text-sm text-muted-foreground">
                资料修改和密码设置仅对正式账号开放。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">个人资料</h1>
        <p className="text-muted-foreground">管理你的账号信息</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-5">
          <div>
            <p className="text-sm text-muted-foreground">邮箱</p>
            <p className="font-medium">{user.email}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">角色</p>
            <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
              {user.role === "ADMIN" ? "管理员" : "普通用户"}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">积分余额</p>
            <p className="flex items-center gap-1.5 font-medium">
              <Coins className="size-4 text-amber-500" />
              {user.credits}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">注册时间</p>
            <p className="font-medium">
              {user.createdAt.toLocaleDateString("zh-CN")}
            </p>
          </div>
        </CardContent>
      </Card>

      <ProfileForms name={user.name ?? ""} />
    </div>
  );
}
