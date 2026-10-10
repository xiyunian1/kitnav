"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGuestMode } from "@/components/guest-mode-provider";
import { createApiTokenAction, revokeApiTokenAction } from "@/app/(app)/settings/api-token-actions";

export interface ApiTokenListItem {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "—";
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("已复制");
  } catch {
    toast.error("复制失败，请手动选择复制");
  }
}

/** 个人访问令牌管理：创建（明文只显示一次）、查看、撤销，并给出 MCP 客户端配置示例。 */
export function ApiTokenManager({ tokens, endpoint }: { tokens: ApiTokenListItem[]; endpoint: string }) {
  const router = useRouter();
  const guest = useGuestMode();
  const [pending, startTransition] = useTransition();
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const tokenForSnippet = created?.token ?? "<你的令牌>";
  const claudeCommand = `claude mcp add --transport http kitnav ${endpoint} --header "Authorization: Bearer ${tokenForSnippet}"`;
  const jsonConfig = JSON.stringify(
    { mcpServers: { kitnav: { url: endpoint, headers: { Authorization: `Bearer ${tokenForSnippet}` } } } },
    null,
    2,
  );

  function onCreate(formData: FormData) {
    formData.set("expiresInDays", expiresInDays);
    startTransition(async () => {
      const result = await createApiTokenAction(formData);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      if ("token" in result && result.token) {
        setCreated({ token: result.token, name: result.name ?? "" });
        router.refresh();
      }
    });
  }

  function onRevoke(id: string) {
    startTransition(async () => {
      const result = await revokeApiTokenAction(id);
      if (result.error) toast.error(result.error);
      else toast.success("已撤销");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          MCP 访问令牌
        </CardTitle>
        <CardDescription>
          在 Claude、Cursor 等支持 MCP 的客户端中直接生成 PPT。令牌代表你的账户，使用平台模型会扣除积分，请勿泄露。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form action={onCreate} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="api-token-name">名称</Label>
            <Input id="api-token-name" name="name" placeholder="例如：Claude Code" maxLength={40} required disabled={guest || pending} />
          </div>
          <div className="space-y-1.5">
            <Label>有效期</Label>
            <Select value={expiresInDays} onValueChange={setExpiresInDays} disabled={guest || pending}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="365">1 年</SelectItem>
                <SelectItem value="never">永不过期</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={guest || pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            创建令牌
          </Button>
        </form>

        {created && (
          <Alert>
            <AlertDescription className="space-y-2">
              <p>令牌「{created.name}」已创建。它只显示这一次，请立即复制保存：</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted px-2 py-1 text-xs">{created.token}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(created.token)}>
                  <Copy className="size-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {tokens.length > 0 && (
          <div className="divide-y rounded-md border text-sm">
            {tokens.map((token) => (
              <div key={token.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium">{token.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {token.tokenPrefix}… · 创建于 {formatDate(token.createdAt)} · 最近使用 {formatDate(token.lastUsedAt)} ·{" "}
                    {token.expiresAt ? `${formatDate(token.expiresAt)} 过期` : "永不过期"}
                  </div>
                </div>
                <Button type="button" size="sm" variant="ghost" disabled={guest || pending} onClick={() => onRevoke(token.id)}>
                  <Trash2 className="size-4" />
                  撤销
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 text-sm">
          <p className="font-medium">客户端配置</p>
          <p className="text-muted-foreground">Claude Code：</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCommand}</pre>
          <p className="text-muted-foreground">Cursor 等使用 JSON 配置的客户端：</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{jsonConfig}</pre>
        </div>
      </CardContent>
    </Card>
  );
}
