"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listConversations,
  getConversation,
  renameConversation,
  deleteConversation,
  clearConversations,
  generateTurnStream,
  editTurnStream,
  type TurnStreamEvent,
} from "../api";
import type { ConversationSummary, ConversationDetail, Turn } from "../types";

function getTurnErrorMessage(turn: Turn, fallback = "生成失败") {
  return turn.images.find((img) => img.status === "error" && img.error)?.error || turn.error || fallback;
}

// 把刷新前残留的 PENDING（queued/loading）轮次标记为失败展示
function recoverStaleTurns(detail: ConversationDetail): ConversationDetail {
  const FIVE_MIN = 5 * 60 * 1000;
  const now = Date.now();
  return {
    ...detail,
    turns: detail.turns.map((turn) => {
      if (turn.status !== "PENDING") return turn;
      if (now - new Date(turn.createdAt).getTime() < FIVE_MIN) return turn;
      const error = getTurnErrorMessage(turn, "任务已中断");
      return {
        ...turn,
        status: "FAILED" as const,
        error,
        images: turn.images.map((img) =>
          img.status === "queued" || img.status === "loading"
            ? { ...img, status: "error" as const, error }
            : img
        ),
      };
    }),
  };
}

export interface SubmitInput {
  prompt: string;
  ratio: string;
  quality: string;
  count: number;
  model?: string;
  mode: "generate" | "edit";
  image?: File;
  referenceThumb?: string;
}

export function useImageWorkbench(initialBalance: number) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreTurns, setLoadingMoreTurns] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [balance, setBalance] = useState(initialBalance);

  const activeIdRef = useRef<string | null>(null);
  const detailCacheRef = useRef<Map<string, ConversationDetail>>(new Map());
  const setCurrentActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const refreshList = useCallback(async (q = "") => {
    try {
      const items = await listConversations(q);
      setConversations(items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取会话失败");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const mergeTurn = useCallback((turn: Turn, fallbackTitle: string) => {
    setCurrentActiveId(turn.conversationId);
    setDetail((prev) => {
      if (prev && prev.id === turn.conversationId) {
        const exists = prev.turns.some((item) => item.id === turn.id);
        const next = {
          ...prev,
          turns: exists
            ? prev.turns.map((item) => (item.id === turn.id ? turn : item))
            : [...prev.turns, turn],
          updatedAt: turn.createdAt,
          totalTurns: exists ? prev.totalTurns : Math.max(prev.totalTurns + 1, prev.turns.length + 1),
        };
        detailCacheRef.current.set(next.id, next);
        return next;
      }
      const next = {
        id: turn.conversationId,
        title: fallbackTitle,
        createdAt: turn.createdAt,
        updatedAt: turn.createdAt,
        turns: [turn],
        totalTurns: 1,
        hasMore: false,
        nextBefore: null,
      };
      detailCacheRef.current.set(next.id, next);
      return next;
    });
  }, [setCurrentActiveId]);

  const patchTurnImage = useCallback((turnId: string, image: Turn["images"][number]) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        turns: prev.turns.map((turn) => {
          if (turn.id !== turnId) return turn;
          return {
            ...turn,
            images: turn.images.map((item) => (item.id === image.id ? image : item)),
          };
        }),
      };
      detailCacheRef.current.set(next.id, next);
      return next;
    });
  }, []);

  // 搜索（防抖）
  useEffect(() => {
    const t = setTimeout(() => void refreshList(search), 300);
    return () => clearTimeout(t);
  }, [search, refreshList]);

  // 加载会话详情
  const selectConversation = useCallback(async (id: string | null) => {
    setCurrentActiveId(id);
    if (!id) {
      setDetail(null);
      return;
    }

    const cached = detailCacheRef.current.get(id);
    if (cached) {
      setDetail(recoverStaleTurns(cached));
      setLoadingDetail(false);
    } else {
      setLoadingDetail(true);
    }

    try {
      const d = await getConversation(id);
      if (activeIdRef.current === id) {
        const recovered = recoverStaleTurns(d);
        detailCacheRef.current.set(id, recovered);
        setDetail(recovered);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取会话失败");
    } finally {
      if (activeIdRef.current === id) setLoadingDetail(false);
    }
  }, [setCurrentActiveId]);

  const loadMoreTurns = useCallback(async () => {
    const current = detail;
    if (!current || !current.hasMore || !current.nextBefore || loadingMoreTurns) return;
    setLoadingMoreTurns(true);
    try {
      const olderPages: Turn[][] = [];
      let hasMore: boolean = current.hasMore;
      let nextBefore: string | null = current.nextBefore;
      let totalTurns = current.totalTurns;

      while (hasMore && nextBefore) {
        const older = await getConversation(current.id, { before: nextBefore, take: 20 });
        if (activeIdRef.current !== current.id) return;
        if (older.turns.length === 0) {
          hasMore = false;
          nextBefore = null;
          break;
        }

        olderPages.push(older.turns);
        totalTurns = older.totalTurns;
        hasMore = older.hasMore;
        nextBefore = older.nextBefore;
      }

      setDetail((prev) => {
        if (!prev || prev.id !== current.id) return prev;
        const existing = new Set(prev.turns.map((turn) => turn.id));
        const olderTurns = olderPages
          .reverse()
          .flat()
          .filter((turn) => !existing.has(turn.id));
        const mergedTurns = [
          ...olderTurns,
          ...prev.turns,
        ];
        const next = recoverStaleTurns({
          ...prev,
          turns: mergedTurns,
          totalTurns,
          hasMore,
          nextBefore,
        });
        detailCacheRef.current.set(next.id, next);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取更早记录失败");
    } finally {
      setLoadingMoreTurns(false);
    }
  }, [detail, loadingMoreTurns]);

  const startNewDraft = useCallback(() => {
    setCurrentActiveId(null);
    setDetail(null);
  }, [setCurrentActiveId]);

  // 提交一轮生成
  const submit = useCallback(
    async (input: SubmitInput) => {
      setSubmitting(true);
      const finalTurnRef: { current: Turn | null } = { current: null };
      try {
        const handleEvent = (event: TurnStreamEvent) => {
          if (event.type === "error") {
            throw new Error(event.error);
          }
          if (event.type === "created") {
            mergeTurn(event.turn, input.prompt.slice(0, 12) || "新会话");
            return;
          }
          if (event.type === "image") {
            patchTurnImage(event.turnId, event.image);
            return;
          }
          if (event.type === "final") {
            finalTurnRef.current = event.turn;
            mergeTurn(event.turn, input.prompt.slice(0, 12) || "新会话");
          }
        };

        if (input.mode === "edit" && input.image) {
          await editTurnStream(
            {
                conversationId: activeIdRef.current ?? undefined,
                prompt: input.prompt,
                ratio: input.ratio,
                quality: input.quality,
                count: input.count,
                model: input.model,
                image: input.image,
                referenceThumb: input.referenceThumb,
            },
            handleEvent
          );
        } else {
          await generateTurnStream(
            {
                conversationId: activeIdRef.current ?? undefined,
                prompt: input.prompt,
                ratio: input.ratio,
                quality: input.quality,
                count: input.count,
                model: input.model,
            },
            handleEvent
          );
        }

        if (!finalTurnRef.current) throw new Error("生成未完成");

        // 反馈
        const turn = finalTurnRef.current;
        const ok = turn.images.filter((i) => i.status === "success").length;
        const fail = turn.count - ok;
        if (ok > 0 && fail === 0) {
          toast.success(turn.usedOwnKey ? "生成成功" : `生成成功，消耗 ${turn.creditsCost} 积分`);
        } else if (ok > 0) {
          toast.warning(`成功 ${ok} 张，失败 ${fail} 张：${getTurnErrorMessage(turn)}`);
        } else {
          toast.error(getTurnErrorMessage(turn));
        }

        if (!turn.usedOwnKey) setBalance((b) => b - turn.creditsCost);
        void refreshList(search);
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "生成失败");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [mergeTurn, patchTurnImage, refreshList, search]
  );

  const rename = useCallback(async (id: string, title: string) => {
    try {
      await renameConversation(id, title);
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
      setDetail((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重命名失败");
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeIdRef.current === id) {
          setCurrentActiveId(null);
          setDetail(null);
        }
        detailCacheRef.current.delete(id);
        toast.success("已删除会话");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "删除失败");
      }
    },
    [setCurrentActiveId]
  );

  const clearAll = useCallback(async () => {
    try {
      await clearConversations();
      setConversations([]);
      setCurrentActiveId(null);
      setDetail(null);
      detailCacheRef.current.clear();
      toast.success("已清空全部会话");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清空失败");
    }
  }, [setCurrentActiveId]);

  return {
    conversations,
    activeId,
    detail,
    search,
    setSearch,
    loadingList,
    loadingDetail,
    loadingMoreTurns,
    submitting,
    balance,
    selectConversation,
    loadMoreTurns,
    startNewDraft,
    submit,
    rename,
    remove,
    clearAll,
  };
}
