"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  listConversations,
  getConversation,
  renameConversation,
  deleteConversation,
  clearConversations,
  cancelTurn,
  generateTurnStream,
  editTurnStream,
  type TurnStreamEvent,
} from "../api";
import type { ConversationSummary, ConversationDetail, Turn } from "../types";

function getTurnErrorMessage(turn: Turn, fallback = "生成失败") {
  return turn.images.find((img) => img.status === "error" && img.error)?.error || turn.error || fallback;
}

const DETAIL_CACHE_LIMIT = 20;

// LRU 写入：重插键使其移到 Map 尾部，超限时淘汰最旧（头部）条目
function cacheDetail(cache: Map<string, ConversationDetail>, detail: ConversationDetail) {
  cache.delete(detail.id);
  cache.set(detail.id, detail);
  if (cache.size > DETAIL_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
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
  const [stopping, setStopping] = useState(false);
  const [balance, setBalance] = useState(initialBalance);

  const activeIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const detailCacheRef = useRef<Map<string, ConversationDetail>>(new Map());
  // 镜像最新 state，让 submit/loadMoreTurns 不依赖响应式值，保持引用稳定（配合 memo 子组件）
  const detailRef = useRef<ConversationDetail | null>(null);
  const searchRef = useRef("");
  const submittingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
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
        cacheDetail(detailCacheRef.current, next);
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
      cacheDetail(detailCacheRef.current, next);
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
      cacheDetail(detailCacheRef.current, next);
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
        cacheDetail(detailCacheRef.current, recovered);
        setDetail(recovered);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取会话失败");
    } finally {
      if (activeIdRef.current === id) setLoadingDetail(false);
    }
  }, [setCurrentActiveId]);

  const loadMoreTurns = useCallback(async () => {
    const current = detailRef.current;
    if (!current || !current.hasMore || !current.nextBefore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMoreTurns(true);
    try {
      const older = await getConversation(current.id, { before: current.nextBefore, take: 20 });
      if (activeIdRef.current !== current.id) return;

      setDetail((prev) => {
        if (!prev || prev.id !== current.id) return prev;
        const existing = new Set(prev.turns.map((turn) => turn.id));
        const olderTurns = older.turns.filter((turn) => !existing.has(turn.id));
        const next = recoverStaleTurns({
          ...prev,
          turns: [...olderTurns, ...prev.turns],
          totalTurns: older.totalTurns,
          hasMore: olderTurns.length === 0 ? false : older.hasMore,
          nextBefore: olderTurns.length === 0 ? null : older.nextBefore,
        });
        cacheDetail(detailCacheRef.current, next);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取更早记录失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreTurns(false);
    }
  }, []);

  const startNewDraft = useCallback(() => {
    setCurrentActiveId(null);
    setDetail(null);
  }, [setCurrentActiveId]);

  const stopGeneration = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    setStopping(true);
    const turnId = activeTurnIdRef.current;
    if (turnId) {
      void cancelTurn(turnId)
        .then((turn) => {
          mergeTurn(turn, turn.prompt.slice(0, 12) || "新会话");
        })
        .catch((e) => {
          toast.error(e instanceof Error ? e.message : "停止生成失败");
        });
    }
    setDetail((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        turns: prev.turns.map((turn) => {
          if (turn.status !== "PENDING") return turn;
          return {
            ...turn,
            status: "FAILED" as const,
            error: "用户已停止生成",
            images: turn.images.map((image) =>
              image.status === "queued" || image.status === "loading"
                ? { ...image, status: "error" as const, error: "用户已停止生成" }
                : image
            ),
          };
        }),
      };
      cacheDetail(detailCacheRef.current, next);
      return next;
    });
    controller.abort("用户已停止生成");
  }, [mergeTurn]);

  // 提交一轮生成
  const submit = useCallback(
    async (input: SubmitInput) => {
      if (submittingRef.current) return false;
      submittingRef.current = true;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeTurnIdRef.current = null;
      setSubmitting(true);
      setStopping(false);
      const finalTurnRef: { current: Turn | null } = { current: null };
      try {
        const handleEvent = (event: TurnStreamEvent) => {
          if (controller.signal.aborted) return;
          if (event.type === "error") {
            throw new Error(event.error);
          }
          if (event.type === "created") {
            activeTurnIdRef.current = event.turn.id;
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
            handleEvent,
            { signal: controller.signal }
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
            handleEvent,
            { signal: controller.signal }
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
        void refreshList(searchRef.current);
        return true;
      } catch (e) {
        if (controller.signal.aborted) {
          toast.info("已停止生成");
        } else {
          toast.error(e instanceof Error ? e.message : "生成失败");
        }
        return false;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (abortControllerRef.current === null) {
          activeTurnIdRef.current = null;
        }
        submittingRef.current = false;
        setSubmitting(false);
        setStopping(false);
      }
    },
    [mergeTurn, patchTurnImage, refreshList]
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
    stopping,
    balance,
    selectConversation,
    loadMoreTurns,
    startNewDraft,
    submit,
    stopGeneration,
    rename,
    remove,
    clearAll,
  };
}
