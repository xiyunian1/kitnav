"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  size?: "sm" | "default";
  variant?: "outline" | "destructive";
  onCancelled?: () => void;
  className?: string;
}

export function CancelProjectButton({
  projectId,
  size = "sm",
  variant = "outline",
  onCancelled,
  className,
}: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleCancel() {
    setPending(true);
    try {
      const res = await fetch(`/api/ppt/projects/${projectId}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "停止失败");
      toast.success(data.refunded ? "已停止生成，积分已退回。" : "已停止生成。");
      onCancelled?.();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "停止失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" size={size} variant={variant} disabled={pending} onClick={handleCancel} className={cn(className)}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
      停止生成
    </Button>
  );
}
