"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function normalize(list: string[]) {
  return Array.from(new Set(list.map((item) => item.trim()).filter(Boolean)));
}

interface Props {
  selectedModels: string[];
  candidateModels: string[];
  onSelectedModelsChange: (models: string[]) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModels,
  candidateModels,
  onSelectedModelsChange,
  disabled = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [manualModel, setManualModel] = useState("");

  const selected = useMemo(() => normalize(selectedModels), [selectedModels]);
  const candidates = useMemo(
    () => normalize([...candidateModels, ...selected]),
    [candidateModels, selected]
  );

  const filtered = candidates.filter((model) => {
    if (query && !model.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function setSelected(next: string[]) {
    onSelectedModelsChange(normalize(next));
  }

  function toggle(model: string) {
    setSelected(selected.includes(model) ? selected.filter((item) => item !== model) : [...selected, model]);
  }

  function addManual() {
    const value = manualModel.trim();
    if (!value) return;
    setSelected([...selected, value]);
    setManualModel("");
  }

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Label>模型配置</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            勾选并保存可在对应生成模块中使用的模型。
          </p>
        </div>
        <Badge variant="outline">{selected.length} 个已选</Badge>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            placeholder="搜索模型"
            disabled={disabled}
          />
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={() => setSelected(candidates)}
          disabled={disabled}
        >
          全选
        </Button>
        <Button
          variant="outline"
          type="button"
          onClick={() => setSelected([])}
          disabled={disabled}
        >
          清空
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border">
        {filtered.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            没有匹配的模型
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((model) => {
              const checked = selected.includes(model);
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => toggle(model)}
                  disabled={disabled}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted",
                    checked && "bg-muted/70"
                  )}
                >
                  <span className="min-w-0 truncate">{model}</span>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded border",
                      checked ? "border-primary bg-primary text-primary-foreground" : "text-transparent"
                    )}
                  >
                    <Check className="size-3.5" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((model) => (
            <Badge key={model} variant="secondary" className="gap-1">
              {model}
              <button
                type="button"
                onClick={() => toggle(model)}
                title="移除"
                aria-label={`移除模型：${model}`}
                disabled={disabled}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={manualModel}
          onChange={(e) => setManualModel(e.target.value)}
          placeholder="手动添加模型名"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={addManual}
          disabled={disabled}
        >
          <Plus className="size-4" /> 添加
        </Button>
      </div>
    </div>
  );
}
