"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground">加载失败，请稍后重试</p>
      <Button variant="outline" onClick={reset}>
        重试
      </Button>
    </div>
  );
}
