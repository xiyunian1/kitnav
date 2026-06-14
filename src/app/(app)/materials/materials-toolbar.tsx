"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TABS = [
  { value: "IMAGE", label: "图片素材" },
  { value: "VIDEO", label: "视频素材" },
  { value: "PROMPT", label: "提示词" },
  { value: "PPT_STYLE", label: "PPT 风格" },
] as const;

interface Props {
  q: string;
  type: string;
  children: ReactNode;
}

export function MaterialsToolbar({ q, type, children }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(q);
  const skipNextSearchRef = useRef(true);

  const navigate = (nextQ: string, nextType: string) => {
    const params = new URLSearchParams();
    if (nextType !== "IMAGE") params.set("type", nextType);
    if (nextQ) params.set("q", nextQ);
    const query = params.toString();
    startTransition(() => {
      router.replace(`/materials${query ? `?${query}` : ""}`, { scroll: false });
    });
  };

  // 搜索防抖；首渲染跳过，避免挂载即触发一次导航
  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const t = setTimeout(() => navigate(value.trim(), type), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {children}
        <div className="relative w-full max-w-sm">
          {pending ? (
            <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="pl-9"
            placeholder="搜索素材、标签、描述"
            aria-label="搜索素材"
          />
        </div>
      </div>

      <div className={cn("flex gap-2 transition-opacity", pending && "opacity-60")}>
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => navigate(value.trim(), tab.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              type === tab.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
