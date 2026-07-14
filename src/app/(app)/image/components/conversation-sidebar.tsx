"use client";

import { memo } from "react";
import {
  ChevronDown,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "../types";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  search: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  balance: number;
  useOwnKey: boolean;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onLoadMore: () => void;
}

function formatTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const ConversationSidebar = memo(function ConversationSidebar({
  conversations,
  activeId,
  search,
  loading,
  loadingMore,
  hasMore,
  balance,
  useOwnKey,
  onSearch,
  onSelect,
  onNew,
  onDelete,
  onClear,
  onLoadMore,
}: Props) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <Button className="flex-1" size="sm" onClick={onNew}>
          <Plus className="size-4" /> 新建会话
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onClear}
          disabled={conversations.length === 0}
          title="清空全部会话"
          aria-label="清空全部会话"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索会话"
          className="pl-8"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 px-1 py-1" aria-label="正在加载会话">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-2">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">暂无会话，点击上方新建</p>
        ) : (
          <>
            {conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition",
                  activeId === c.id
                    ? "border-primary/40 bg-muted"
                    : "border-transparent hover:bg-muted/60",
                )}
                onClick={() => onSelect(c.id)}
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.turnCount} 轮 · {formatTime(c.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  title="删除会话"
                  aria-label={`删除会话：${c.title}`}
                >
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
            {hasMore && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ChevronDown className="size-4" />
                )}
                加载更多
              </Button>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg border bg-muted/40 px-3 py-2">
        <div className="text-xs text-muted-foreground">{useOwnKey ? "我的 API" : "剩余积分"}</div>
        <div className="text-lg font-bold">{useOwnKey ? "不消耗积分" : balance}</div>
      </div>
    </div>
  );
});
