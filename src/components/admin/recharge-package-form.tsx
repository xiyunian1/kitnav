"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { RechargePackageView } from "@/lib/recharge-packages";
import {
  deleteRechargePackageAction,
  saveRechargePackageAction,
} from "@/app/admin/operations/actions";

function getActionError(res: unknown) {
  return res && typeof res === "object" && "error" in res
    ? String((res as { error?: unknown }).error || "")
    : "";
}

export function RechargePackageForm({ pkg }: { pkg?: RechargePackageView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(pkg?.code ?? "");
  const [label, setLabel] = useState(pkg?.label ?? "");
  const [credits, setCredits] = useState(String(pkg?.credits ?? 100));
  const [amount, setAmount] = useState(String(pkg?.amount ?? 100));
  const [sortOrder, setSortOrder] = useState(String(pkg?.sortOrder ?? 0));
  const [enabled, setEnabled] = useState(pkg?.enabled ?? true);
  const [popular, setPopular] = useState(pkg?.popular ?? false);

  function save() {
    startTransition(async () => {
      const res = await saveRechargePackageAction({
        id: pkg?.id,
        code,
        label,
        credits: Number(credits),
        amount: Number(amount),
        sortOrder: Number(sortOrder),
        enabled,
        popular,
      });
      const error = getActionError(res);
      if (error) toast.error(error);
      else {
        toast.success("套餐已保存");
        router.refresh();
      }
    });
  }

  function remove() {
    if (!pkg) return;
    startTransition(async () => {
      const res = await deleteRechargePackageAction(pkg.id);
      const error = getActionError(res);
      if (error) toast.error(error);
      else {
        toast.success("套餐已删除");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[1fr_1fr_100px_100px_80px_80px_80px_auto]">
      <Input placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} />
      <Input placeholder="名称" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input type="number" placeholder="积分" value={credits} onChange={(e) => setCredits(e.target.value)} />
      <Input type="number" placeholder="金额(分)" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input type="number" placeholder="排序" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={enabled} onCheckedChange={setEnabled} /> 启用
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={popular} onCheckedChange={setPopular} /> 热门
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : pkg ? <Save className="size-4" /> : <Plus className="size-4" />}
          保存
        </Button>
        {pkg && (
          <Button size="sm" variant="outline" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
