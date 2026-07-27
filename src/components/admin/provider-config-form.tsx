"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModelSelector } from "@/components/api-config/model-selector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plug, Save, ListChecks } from "lucide-react";
import {
  saveProviderConfigAction,
  testProviderConfigAction,
} from "@/app/admin/api-config/actions";
import {
  PPT_THINKING_LEVELS,
  normalizePptThinkingLevel,
  type PptThinkingLevel,
} from "@/lib/ppt-agent/model-options";

export interface ProviderConfigInitial {
  module: string;
  moduleName: string;
  baseUrl: string;
  model: string;
  models: string;
  modelMeta: Record<string, { enabled?: boolean; creditCost?: number; note?: string }>;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string;
  active: boolean; // 模块是否已上线
  description?: string;
  modelKind?: "image" | "text";
  modelOptions?: {
    thinkingLevel?: PptThinkingLevel;
    visionModels?: string[];
  };
}

const PPT_THINKING_LABELS: Record<PptThinkingLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
};

export function ProviderConfigForm({ initial }: { initial: ProviderConfigInitial }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [selectedModels, setSelectedModels] = useState(
    (initial.models || initial.model)
      .split(/[,\n，、]+/)
      .map((m) => m.trim())
      .filter(Boolean)
  );
  const [modelMeta, setModelMeta] = useState(initial.modelMeta);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(initial.enabled);
  const [thinkingLevel, setThinkingLevel] = useState<PptThinkingLevel>(
    normalizePptThinkingLevel(initial.modelOptions?.thinkingLevel)
  );
  const [visionModels, setVisionModels] = useState<string[]>(
    initial.modelOptions?.visionModels ?? []
  );
  const [saving, startSave] = useTransition();
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const modelKind = initial.modelKind ?? "image";

  function preferredModels(list: string[]) {
    const filtered = list.filter((m) => {
      const v = m.toLowerCase();
      if (modelKind === "text") {
        return (
          v.includes("gpt") ||
          v.includes("chat") ||
          v.includes("deepseek") ||
          v.includes("qwen") ||
          v.includes("glm") ||
          v.includes("claude") ||
          v.includes("gemini") ||
          v.includes("kimi") ||
          v.includes("doubao") ||
          v.includes("instruct")
        );
      }
      return v.includes("image") || v.includes("dall-e") || v.includes("flux");
    });
    return filtered.length ? filtered : list;
  }

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
      const res = await fetch("/api/admin/api-config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module: initial.module,
          baseUrl,
          apiKey: apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.models)) {
        setModels(data.models);
        const next = preferredModels(data.models);
        setSelectedModels((prev) => (prev.length ? prev : next));
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
    const testModel = selectedModels[0]?.trim();
    if (!baseUrl || !testModel) {
      toast.error("请填写 Base URL 并至少保存一个模型");
      return;
    }
    if (!apiKey && !initial.hasKey) {
      toast.error("请填写 API Key");
      return;
    }
    setTesting(true);
    try {
      const res = await testProviderConfigAction({
        module: initial.module,
        baseUrl,
        apiKey: apiKey || undefined,
        model: testModel,
      });
      if (res.ok) toast.success("连接成功，上游可用");
      else toast.error(`连接失败：${res.error || "未知错误"}`);
    } finally {
      setTesting(false);
    }
  }

  function handleSave() {
    const fallbackModel = selectedModels[0]?.trim();
    if (!baseUrl || !fallbackModel) {
      toast.error("请填写 Base URL 并至少保存一个模型");
      return;
    }
    if (!apiKey && !initial.hasKey) {
      toast.error("请填写 API Key");
      return;
    }
    startSave(async () => {
      const res = await saveProviderConfigAction({
        module: initial.module as never,
        baseUrl,
        apiKey: apiKey || undefined,
        model: fallbackModel,
        models: selectedModels,
        modelMeta,
        modelOptions:
          initial.module === "PPT"
            ? {
                thinkingLevel,
                visionModels: visionModels.filter((model) => selectedModels.includes(model)),
              }
            : undefined,
        enabled,
      });
      if (res?.error) {
        toast.error(res.error);
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
          <span className="flex items-center gap-2">
            {initial.moduleName}
            {!initial.active && <Badge variant="secondary">即将上线</Badge>}
          </span>
          <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            启用
            <Switch
              aria-label={`${enabled ? "停用" : "启用"}${initial.moduleName}`}
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {initial.description ||
            "平台上游配置。保存并启用后，用户可在对应生成模块中选择这些平台模型。"}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
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
              placeholder={
                initial.hasKey ? `已配置（${initial.maskedKey}），留空则不修改` : "sk-..."
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
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
        <div
          className={
            initial.module === "PPT" || modelKind === "image"
              ? "grid gap-4 xl:grid-cols-2 xl:items-start"
              : undefined
          }
        >
          <ModelSelector
            selectedModels={selectedModels}
            candidateModels={models}
            onSelectedModelsChange={setSelectedModels}
          />
          {initial.module === "PPT" && (
          <div className="space-y-4 rounded-lg border p-3">
            <div className="space-y-2">
              <Label>推理强度</Label>
            <Select
              value={thinkingLevel}
              onValueChange={(value) => setThinkingLevel(normalizePptThinkingLevel(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPT_THINKING_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {PPT_THINKING_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
            <div className="space-y-2">
              <Label>视觉模型</Label>
              {selectedModels.map((model) => (
                <label
                  key={model}
                  className="flex min-h-9 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{model}</span>
                  <Switch
                    aria-label={`${visionModels.includes(model) ? "关闭" : "开启"}视觉能力：${model}`}
                    checked={visionModels.includes(model)}
                    onCheckedChange={(checked) =>
                      setVisionModels((current) =>
                        checked
                          ? Array.from(new Set([...current, model]))
                          : current.filter((item) => item !== model)
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {modelKind === "image" && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-sm font-medium">模型运营</div>
            <p className="text-xs text-muted-foreground">
              可单独停用模型或设置该模型每张图片积分单价；留空则使用系统图片单价。
            </p>
            <div className="space-y-2">
              {selectedModels.map((item) => {
                const meta = modelMeta[item] ?? {};
                return (
                  <div key={item} className="grid items-center gap-2 md:grid-cols-[1fr_90px_110px]">
                    <span className="truncate text-sm">{item}</span>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        aria-label={`${meta.enabled === false ? "启用" : "停用"}模型：${item}`}
                        checked={meta.enabled !== false}
                        onCheckedChange={(checked) =>
                          setModelMeta((prev) => ({
                            ...prev,
                            [item]: { ...(prev[item] ?? {}), enabled: checked },
                          }))
                        }
                      />
                      启用
                    </label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="单价"
                      value={meta.creditCost ?? ""}
                      onChange={(e) =>
                        setModelMeta((prev) => ({
                          ...prev,
                          [item]: {
                            ...(prev[item] ?? {}),
                            creditCost: e.target.value === "" ? undefined : Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
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
