"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Loader2 } from "lucide-react";
import {
  setUserRoleAction,
  setUserStatusAction,
  adjustUserCreditsAction,
} from "@/app/admin/users/actions";

interface Props {
  user: {
    id: string;
    role: "USER" | "ADMIN";
    status: "ACTIVE" | "BANNED";
  };
}

export function UserRowActions({ user }: Props) {
  const [pending, startTransition] = useTransition();
  const [creditOpen, setCreditOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  function run(
    fn: () => Promise<{ ok?: boolean; error?: string } | void>,
    ok: string
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res && "error" in res && res.error) toast.error(res.error);
      else toast.success(ok);
    });
  }

  function handleAdjust() {
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      toast.error("请输入非零整数");
      return;
    }
    startTransition(async () => {
      const res = await adjustUserCreditsAction(user.id, d, reason);
      if (res?.error) toast.error(res.error);
      else {
        toast.success("积分已调整");
        setCreditOpen(false);
        setDelta("");
        setReason("");
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={pending} aria-label="更多用户操作">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setCreditOpen(true)}>
            调整积分
          </DropdownMenuItem>
          {user.role === "USER" ? (
            <DropdownMenuItem
              onClick={() =>
                run(() => setUserRoleAction(user.id, "ADMIN"), "已设为管理员")
              }
            >
              设为管理员
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                run(() => setUserRoleAction(user.id, "USER"), "已取消管理员")
              }
            >
              取消管理员
            </DropdownMenuItem>
          )}
          {user.status === "ACTIVE" ? (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                run(() => setUserStatusAction(user.id, "BANNED"), "已封禁")
              }
            >
              封禁账号
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                run(() => setUserStatusAction(user.id, "ACTIVE"), "已解封")
              }
            >
              解除封禁
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整积分</DialogTitle>
            <DialogDescription>
              输入正数增加、负数扣减。操作会记入积分流水。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delta">积分变动</Label>
              <Input
                id="delta"
                type="number"
                placeholder="如 100 或 -50"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">备注（可选）</Label>
              <Input
                id="reason"
                placeholder="调整原因"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAdjust} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
