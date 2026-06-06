"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
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

interface RegisterFormProps {
  linuxDoEnabled: boolean;
  registrationMode: string;
}

export function RegisterForm({ linuxDoEnabled, registrationMode }: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRegistrationDisabled = registrationMode === "closed" || registrationMode === "linuxdo";
  const inviteRequired = registrationMode === "invite";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, inviteCode: inviteCode || undefined }),
    });
    const data = await res.json();

    if (!res.ok) {
      setLoading(false);
      toast.error(data.error || "注册失败");
      return;
    }

    const loginRes = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);

    if (loginRes?.error) {
      toast.success("注册成功，请登录");
      router.push("/login");
      return;
    }
    toast.success("注册成功，已赠送积分");
    router.push("/");
    router.refresh();
  }

  function handleLinuxDoSignIn() {
    void signIn("linux-do", { callbackUrl: "/" });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">注册</CardTitle>
        <CardDescription>注册即送积分，立即体验 AI 创作</CardDescription>
      </CardHeader>
      <CardContent>
        {registrationMode === "closed" && (
          <div className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            当前暂未开放注册。
          </div>
        )}
        {linuxDoEnabled && registrationMode !== "invite" && registrationMode !== "closed" && (
          <>
            <Button
              type="button"
              variant="outline"
              className="mb-4 w-full"
              onClick={handleLinuxDoSignIn}
            >
              使用 Linux.do 注册/登录
            </Button>
            <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>或使用邮箱注册</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">昵称（可选）</Label>
            <Input
              id="name"
              placeholder="你的昵称"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
              placeholder="至少 6 位"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          {inviteRequired && (
            <div className="space-y-2">
              <Label htmlFor="inviteCode">邀请码</Label>
              <Input
                id="inviteCode"
                placeholder="请输入邀请码"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
              />
            </div>
          )}
          {registrationMode === "linuxdo" && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              当前仅支持 Linux.do 注册/登录。
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading || emailRegistrationDisabled}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            注册
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          已有账号？{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            登录
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
