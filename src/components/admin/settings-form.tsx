"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { SETTING_META } from "@/lib/settings-config";
import { updateSettingsAction } from "@/app/admin/settings/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 布尔设置项：Radix Switch 不进 FormData，用受控 state + 隐藏 input 保证始终提交 0/1。
function BooleanField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const [checked, setChecked] = useState(defaultValue === "1");
  return (
    <div className="flex items-center gap-3">
      <input type="hidden" name={name} value={checked ? "1" : "0"} />
      <Switch checked={checked} onCheckedChange={setChecked} />
      <span className="text-sm text-muted-foreground">
        {checked ? "已开启" : "已关闭"}
      </span>
    </div>
  );
}

export function SettingsForm({
  values,
  meta = SETTING_META,
}: {
  values: Record<string, string>;
  meta?: typeof SETTING_META;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const groups = Array.from(new Set(meta.map((item) => item.group ?? "其他")));

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await updateSettingsAction(formData);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("设置已保存");
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {groups.map((group) => (
        <div key={group} className="space-y-4">
          <h3 className="border-b pb-2 text-sm font-semibold">{group}</h3>
          {meta.filter((item) => (item.group ?? "其他") === group).map((item) => (
            <div key={item.key} className="space-y-2">
              <Label htmlFor={item.key}>{item.label}</Label>
              {item.type === "boolean" ? (
                <BooleanField name={item.key} defaultValue={values[item.key] ?? "0"} />
              ) : item.options ? (
                <Select name={item.key} defaultValue={values[item.key] ?? ""}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {item.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={item.key}
                  name={item.key}
                  type={item.type === "number" ? "number" : "text"}
                  defaultValue={values[item.key] ?? ""}
                  min={item.type === "number" ? item.min ?? 0 : undefined}
                  max={item.type === "number" ? item.max : undefined}
                  step={item.type === "number" ? item.step ?? "any" : undefined}
                />
              )}
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        保存设置
      </Button>
    </form>
  );
}
