"use client";

import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TurnCard } from "./turn-card";
import type { ConversationDetail, ReuseTurnInput } from "../types";

interface Props {
  detail: ConversationDetail | null;
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onContinueEdit: (url: string) => void;
  onReusePrompt: (prompt: string) => void;
  onRegenerate: (input: ReuseTurnInput) => void;
  onGenerateSimilar: (url: string, input: ReuseTurnInput) => void;
}

export const ResultStream = memo(function ResultStream({
  detail,
  loading,
  loadingMore,
  onLoadMore,
  onContinueEdit,
  onReusePrompt,
  onRegenerate,
  onGenerateSimilar,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollStateRef = useRef({
    detailId: null as string | null,
    firstTurnId: null as string | null,
    lastTurnId: null as string | null,
    scrollHeight: 0,
    scrollTop: 0,
  });

  const rememberScrollState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !detail || detail.turns.length === 0) return;
    scrollStateRef.current = {
      detailId: detail.id,
      firstTurnId: detail.turns[0]?.id ?? null,
      lastTurnId: detail.turns[detail.turns.length - 1]?.id ?? null,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };
  }, [detail]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !detail || detail.turns.length === 0) return;
    const previous = scrollStateRef.current;
    const firstTurnId = detail.turns[0]?.id ?? null;
    const lastTurnId = detail.turns[detail.turns.length - 1]?.id ?? null;
    const sameConversation = previous.detailId === detail.id;
    const prependedOlderTurns =
      sameConversation &&
      previous.lastTurnId === lastTurnId &&
      previous.firstTurnId !== firstTurnId &&
      previous.scrollHeight > 0;

    if (prependedOlderTurns) {
      viewport.scrollTop = previous.scrollTop + (viewport.scrollHeight - previous.scrollHeight);
    } else if (!sameConversation || previous.lastTurnId !== lastTurnId) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }

    scrollStateRef.current = {
      detailId: detail.id,
      firstTurnId,
      lastTurnId,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    };
  }, [detail]);

  if (loading && (!detail || detail.turns.length === 0)) {
    return (
      <div className="h-full space-y-4 overflow-hidden" aria-label="正在加载生成记录">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-card">
            <div className="space-y-2 border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-4 w-12" />
              </div>
              <Skeleton className="h-4 w-11/12" />
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="aspect-square rounded-lg" />
              <Skeleton className="hidden aspect-square rounded-lg sm:block" />
              <Skeleton className="hidden aspect-square rounded-lg lg:block" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!detail || detail.turns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted-foreground">
        <div className="flex size-16 items-center justify-center rounded-2xl border bg-background">
          <ImageIcon className="size-8 opacity-50" />
        </div>
        <div>
          <p className="font-medium text-foreground">开始你的图片创作</p>
          <p className="mt-1 max-w-sm text-sm">
            在右侧输入提示词，支持文生图与图生图。生成结果会按轮次显示在这里。
          </p>
        </div>
      </div>
    );
  }

  const startIndex = Math.max(0, detail.totalTurns - detail.turns.length);

  return (
    <div
      ref={viewportRef}
      data-result-stream
      className="relative h-full space-y-4 overflow-y-auto pr-1"
      onScroll={rememberScrollState}
    >
      {loading && (
        <div className="sticky top-2 z-10 ml-auto flex w-fit items-center gap-1 rounded-full border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Loader2 className="size-3 animate-spin" />
          更新中
        </div>
      )}
      {detail.hasMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                加载中
              </>
            ) : (
              "加载更早记录"
            )}
          </Button>
        </div>
      )}
      {detail.turns.map((turn, i) => (
        <TurnCard
          key={turn.id}
          turn={turn}
          index={startIndex + i}
          onContinueEdit={onContinueEdit}
          onReusePrompt={onReusePrompt}
          onRegenerate={onRegenerate}
          onGenerateSimilar={onGenerateSimilar}
        />
      ))}
    </div>
  );
});
