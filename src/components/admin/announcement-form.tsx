"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  deleteAnnouncementAction,
  saveAnnouncementAction,
} from "@/app/admin/announcements/actions";

export function AnnouncementForm({
  item,
}: {
  item?: { id: string; title: string; content: string; placement: string; enabled: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [placement, setPlacement] = useState(item?.placement ?? "APP");
  const [enabled, setEnabled] = useState(item?.enabled ?? true);

  function save() {
    startTransition(async () => {
      const res = await saveAnnouncementAction({ id: item?.id, title, content, placement, enabled });
      if (res?.error) toast.error(res.error);
      else {
        toast.success("公告已保存");
        router.refresh();
      }
    });
  }

  function remove() {
    if (!item) return;
    startTransition(async () => {
      const res = await deleteAnnouncementAction(item.id);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("公告已删除");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_140px_auto]">
        <Input placeholder="标题" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input placeholder="位置" value={placement} onChange={(e) => setPlacement(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            aria-label={enabled ? "停用公告" : "启用公告"}
            checked={enabled}
            onCheckedChange={setEnabled}
          /> 启用
        </label>
      </div>
      <Textarea placeholder="公告内容" value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存
        </Button>
        {item && (
          <Button size="sm" variant="outline" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" /> 删除
          </Button>
        )}
      </div>
    </div>
  );
}
