"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelSelector } from "@/components/api-config/model-selector";
import { Loader2, Plug, Save, ListChecks } from "lucide-react";

export interface UserConfigInitial {
  module: string;
  baseUrl: string;
  model: string;
  models: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string;
}

export function UserApiConfigForm({ initial }: { initial: UserConfigInitial }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [selectedModels, setSelectedModels] = useState(
    (initial.models || initial.model)
      .split(/[,\n，、]+/)
      .map((m) => m.trim())
      .filter(Boolean)
  );
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, startSave] = useTransition();
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  async function handleFetchModels() {
    if (!baseUrl) {
      toast.error("请先填写 Base URL");
      return;
    }
    if (!apiKey && !initial.hasKey) {
      toast.error("请填写 API Key");
      return;
    }
    setFetchingModels(true);
    try {
      const res = await fetch("/api/user/api-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: initial.module, baseUrl, apiKey }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models)) {
        setModels(data.models);
        const imageModels = data.models.filter((m: string) => {
          const v = m.toLowerCase();
          return v.includes("image") || v.includes("dall-e") || v.includes("flux");
        });
        const next = imageModels.length ? imageModels : data.models;
        setSelectedModels((prev) => (prev.length ? prev : next));
        if (!model && next[0]) setModel(next[0]);
        toast.success(`获取到 ${data.models.length} 个模型`);
      } else {
        toast.error(`获取失败：${data.error || "未知错误"}`);
      }
    } catch {
      toast.error("获取模型请求失败");
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleTest() {
    if (!baseUrl || !model) {
      toast.error("请填写 Base URL 并选择默认模型");
      return;
    }
    if (!apiKey && !initial.hasKey) {
      toast.error("请填写 API Key");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/user/api-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: initial.module, baseUrl, apiKey, model }),
      });
      const data = await res.json();
      if (data.ok) toast.success("连接成功，API 可用");
      else toast.error(`连接失败：${data.error || "未知错误"}`);
    } catch {
      toast.error("测试请求失败");
    } finally {
      setTesting(false);
    }
  }

  async function handleEnabledChange(next: boolean) {
    if (!initial.hasKey) {
      toast.error("请先保存 API 配置");
      return;
    }
    const previous = enabled;
    setEnabled(next);
    setSwitching(true);
    try {
      const res = await fetch("/api/user/api-config/enabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: initial.module, enabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEnabled(previous);
        toast.error(data.error || "切换失败");
        return;
      }
      toast.success(next ? "已启用我的 API" : "已切换为平台模型");
      router.refresh();
    } catch {
      setEnabled(previous);
      toast.error("切换失败");
    } finally {
      setSwitching(false);
    }
  }

  function handleSave() {
    if (!baseUrl || !model) {
      toast.error("请填写 Base URL 和模型名");
      return;
    }
    if (!apiKey && !initial.hasKey) {
      toast.error("请填写 API Key");
      return;
    }
    startSave(async () => {
      const res = await fetch("/api/user/api-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: initial.module,
          baseUrl,
          apiKey: apiKey || undefined,
          model,
          models: selectedModels,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "保存失败");
        return;
      }
      toast.success("已保存");
      setApiKey("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span>使用我的 API</span>
          <Switch checked={enabled} onCheckedChange={handleEnabledChange} disabled={switching} />
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          开关会立即生效；保存按钮只保存 Base URL、Key 和模型配置。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Base URL</Label>
          <Input
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>API Key</Label>
          <Input
            type="password"
            placeholder={initial.hasKey ? `已配置（${initial.maskedKey}），留空则不修改` : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleFetchModels}
            disabled={fetchingModels || saving || testing}
          >
            {fetchingModels ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ListChecks className="size-4" />
            )}
            获取模型
          </Button>
        </div>
        <ModelSelector
          defaultModel={model}
          selectedModels={selectedModels}
          candidateModels={models}
          onDefaultModelChange={setModel}
          onSelectedModelsChange={setSelectedModels}
        />
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
            测试连接
          </Button>
          <Button onClick={handleSave} disabled={saving || testing}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
