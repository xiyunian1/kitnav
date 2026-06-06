"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cleanupStuckImageTurnsAction } from "@/app/admin/generations/actions";

export function GenerationCleanupButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cleanupStuckImageTurnsAction();
          if (result.updatedCount > 0) {
            toast.success(`已处理 ${result.updatedCount} 个超时任务，退还 ${result.refundedCredits} 积分`);
          } else {
            toast.info("没有需要处理的超时任务");
          }
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
      清理超时任务
    </Button>
  );
}
