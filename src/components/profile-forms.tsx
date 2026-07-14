"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  updateProfileAction,
  changePasswordAction,
} from "@/app/(app)/profile/actions";
import { AUTH_INPUT_LIMITS } from "@/lib/auth-inputs";

export function ProfileForms({ name }: { name: string }) {
  const router = useRouter();
  const [pendingName, startName] = useTransition();
  const [pendingPwd, startPwd] = useTransition();

  function handleProfile(formData: FormData) {
    startName(async () => {
      const res = await updateProfileAction(formData);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("资料已更新");
        router.refresh();
      }
    });
  }

  function handlePassword(formData: FormData) {
    startPwd(async () => {
      const res = await changePasswordAction(formData);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("密码已修改，请重新登录");
        await signOut({ callbackUrl: "/login" });
      }
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本资料</CardTitle>
          <CardDescription>修改你的昵称</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handleProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">昵称</Label>
              <Input id="name" name="name" defaultValue={name} maxLength={30} />
            </div>
            <Button type="submit" disabled={pendingName}>
              {pendingName && <Loader2 className="size-4 animate-spin" />}
              保存
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">修改密码</CardTitle>
          <CardDescription>定期更换密码更安全</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={handlePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current">当前密码</Label>
              <Input
                id="current"
                name="current"
                type="password"
                maxLength={AUTH_INPUT_LIMITS.loginPasswordCharacters}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next">新密码</Label>
              <Input
                id="next"
                name="next"
                type="password"
                required
                minLength={6}
                maxLength={AUTH_INPUT_LIMITS.newPasswordCharacters}
              />
            </div>
            <Button type="submit" disabled={pendingPwd}>
              {pendingPwd && <Loader2 className="size-4 animate-spin" />}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
