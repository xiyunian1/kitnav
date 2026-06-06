"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createInviteCodeAction, toggleInviteCodeAction } from "@/app/admin/operations/actions";

export function InviteCodeForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [note, setNote] = useState("");

  function create() {
    startTransition(async () => {
      const res = await createInviteCodeAction({ code, maxUses: Number(maxUses), note });
      if (res?.error) toast.error(res.error);
      else {
        toast.success("邀请码已创建");
        setCode("");
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid gap-2 rounded-lg border p-3 lg:grid-cols-[1fr_100px_1fr_auto]">
      <Input placeholder="邀请码" value={code} onChange={(e) => setCode(e.target.value)} />
      <Input type="number" min={1} placeholder="次数" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
      <Input placeholder="备注" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button size="sm" onClick={create} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        创建
      </Button>
    </div>
  );
}

export function InviteToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Switch
      checked={enabled}
      disabled={pending}
      onCheckedChange={(next) =>
        startTransition(async () => {
          await toggleInviteCodeAction(id, next);
          router.refresh();
        })
      }
    />
  );
}
