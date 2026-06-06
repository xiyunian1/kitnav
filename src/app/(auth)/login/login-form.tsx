"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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

interface LoginFormProps {
  linuxDoEnabled: boolean;
}

export function LoginForm({ linuxDoEnabled }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);

    if (res?.error) {
      toast.error("邮箱或密码错误");
      return;
    }
    toast.success("登录成功");
    router.push(callbackUrl);
    router.refresh();
  }

  function handleLinuxDoSignIn() {
    void signIn("linux-do", { callbackUrl });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">登录</CardTitle>
        <CardDescription>登录后即可使用全部 AI 工具</CardDescription>
      </CardHeader>
      <CardContent>
        {linuxDoEnabled && (
          <>
            <Button
              type="button"
              variant="outline"
              className="mb-4 w-full"
              onClick={handleLinuxDoSignIn}
            >
              使用 Linux.do 继续
            </Button>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>或使用邮箱登录</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            登录
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          还没有账号？{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            注册
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
