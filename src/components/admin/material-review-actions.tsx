"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X, Archive, ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveMaterialAction,
  archiveMaterialAction,
  rejectMaterialAction,
  resolveMaterialReportsAction,
} from "@/app/admin/materials/actions";

interface Props {
  id: string;
  status: string;
  reportCount?: number;
}

export function MaterialReviewActions({ id, status, reportCount = 0 }: Props) {
  const [pending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  function run(action: () => Promise<{ ok?: boolean; error?: string }>, message: string) {
    startTransition(async () => {
      try {
        const res = await action();
        if (res?.error) toast.error(res.error);
        else toast.success(message);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "操作失败");
      }
    });
  }

  function submitReject() {
    if (!reason.trim()) {
      toast.error("请填写拒绝原因");
      return;
    }
    run(async () => {
      const res = await rejectMaterialAction(id, reason);
      if (res?.ok) {
        setRejectOpen(false);
        setReason("");
      }
      return res;
    }, "已拒绝");
  }

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        {pending && <Loader2 className="mt-2 size-4 animate-spin text-muted-foreground" />}
        {status !== "APPROVED" && (
          <Button size="sm" onClick={() => run(() => approveMaterialAction(id), "已通过")}>
            <Check className="size-4" /> 通过
          </Button>
        )}
        {status === "PENDING_REVIEW" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setRejectOpen(true)}
          >
            <X className="size-4" /> 拒绝
          </Button>
        )}
        {status === "APPROVED" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(() => archiveMaterialAction(id), "已下架")}
          >
            <Archive className="size-4" /> 下架
          </Button>
        )}
        {reportCount > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => resolveMaterialReportsAction(id, "RESOLVED"), "举报已处理")}
            >
              <ShieldCheck className="size-4" /> 处理举报
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => run(() => resolveMaterialReportsAction(id, "DISMISSED"), "举报已驳回")}
            >
              <ShieldX className="size-4" /> 驳回举报
            </Button>
          </>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝素材</DialogTitle>
            <DialogDescription>
              拒绝原因会显示在用户的“我的素材库”中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reject-${id}`}>拒绝原因</Label>
            <Input
              id={`reject-${id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              placeholder="如：图片内容不清晰、提示词信息不完整"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button variant="destructive" disabled={pending} onClick={submitReject}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              确认拒绝
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
