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
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AUTH_INPUT_LIMITS } from "@/lib/auth-inputs";

interface RegisterFormProps {
  linuxDoEnabled: boolean;
  registrationMode: string;
}

export function RegisterForm({ linuxDoEnabled, registrationMode }: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);

  const isClosed = registrationMode === "closed";
  const isLinuxDoOnly = registrationMode === "linuxdo";
  const inviteRequired = registrationMode === "invite";
  const showEmailForm = !isClosed && !isLinuxDoOnly;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email, password, inviteCode: inviteCode.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(data?.error || "注册失败，请稍后再试");
        return;
      }

      const loginRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (loginRes?.error) {
        toast.success("注册成功，请登录");
        router.push("/login");
        return;
      }
      toast.success("注册成功，已赠送积分");
      router.push("/");
      router.refresh();
    } catch {
      toast.error("网络错误，请检查连接");
    } finally {
      setLoading(false);
    }
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
        {isClosed && (
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            当前暂未开放注册，请稍后再试。
          </div>
        )}

        {isLinuxDoOnly && (
          <>
            <div className="mb-4 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              当前仅支持通过 Linux.do 注册/登录。
            </div>
            {linuxDoEnabled && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleLinuxDoSignIn}
              >
                使用 Linux.do 注册/登录
              </Button>
            )}
          </>
        )}

        {showEmailForm && (
          <>
            {linuxDoEnabled && registrationMode !== "invite" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="mb-4 w-full"
                  onClick={handleLinuxDoSignIn}
                  disabled={loading}
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
              {inviteRequired && (
                <div className="space-y-2">
                  <Label htmlFor="inviteCode">邀请码</Label>
                  <Input
                    id="inviteCode"
                    placeholder="请输入邀请码"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    maxLength={64}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name">昵称（可选）</Label>
                <Input
                  id="name"
                  placeholder="你的昵称"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={30}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={AUTH_INPUT_LIMITS.emailCharacters}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="至少 6 位"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    maxLength={AUTH_INPUT_LIMITS.newPasswordCharacters}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">密码长度为 6-72 个字符</p>
              </div>
              <Button type="submit" className="w-full" disabled={loading} aria-busy={loading}>
                {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {loading ? "注册中..." : "注册"}
              </Button>
            </form>
          </>
        )}

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
