import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForms } from "@/components/profile-forms";
import { Coins } from "lucide-react";

export const metadata = { title: "个人资料" };

export default async function ProfilePage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
  });

  if (!user) return null;

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
