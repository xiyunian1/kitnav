"use client";

import { useState, useTransition } from "react";
import type { FeedbackStatus } from "@prisma/client";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { updateFeedbackAction } from "@/app/admin/feedback/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_OPTIONS = [
  ["NEW", "未读"],
  ["IN_PROGRESS", "处理中"],
  ["RESOLVED", "已解决"],
  ["CLOSED", "已关闭"],
] as const;

export function FeedbackActions({
  id,
  status,
  adminNote,
}: {
  id: string;
  status: FeedbackStatus;
  adminNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [nextStatus, setNextStatus] = useState<FeedbackStatus>(status);
  const [note, setNote] = useState(adminNote ?? "");

  function save() {
    startTransition(async () => {
      const res = await updateFeedbackAction({
        feedbackId: id,
        status: nextStatus,
        adminNote: note,
      });
      if (res?.error) toast.error(res.error);
      else toast.success("反馈已更新");
    });
  }

  return (
    <div className="space-y-2">
      <Select value={nextStatus} onValueChange={(value) => setNextStatus(value as FeedbackStatus)}>
        <SelectTrigger className="h-8 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="管理员备注"
        className="min-w-48 text-xs"
      />
      <Button size="sm" onClick={save} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        保存
      </Button>
    </div>
  );
}
