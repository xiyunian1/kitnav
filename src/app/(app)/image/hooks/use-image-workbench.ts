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
import type { ModelSource } from "@/lib/module-model-options";
import {
  mergeConversationSnapshot,
  replaceConversationTurn,
} from "../image-workbench-state";

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

export interface SubmitInput {
  prompt: string;
  ratio: string;
  quality: string;
  count: number;
  model?: string;
  modelSource?: ModelSource;
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
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [nextConversationCursor, setNextConversationCursor] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingMoreTurns, setLoadingMoreTurns] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stoppingTurnIds, setStoppingTurnIds] = useState<Set<string>>(
    () => new Set(),
  );
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
  const conversationListRequestRef = useRef(0);
  const stoppingTurnIdsRef = useRef<Set<string>>(new Set());
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
    const requestId = ++conversationListRequestRef.current;
    setLoadingList(true);
    setLoadingMoreConversations(false);
    try {
      const page = await listConversations(q);
      if (requestId !== conversationListRequestRef.current) return;
      setConversations(page.conversations);
      setHasMoreConversations(page.hasMore);
      setNextConversationCursor(page.nextCursor);
    } catch (e) {
      if (requestId !== conversationListRequestRef.current) return;
      toast.error(e instanceof Error ? e.message : "读取会话失败");
    } finally {
      if (requestId === conversationListRequestRef.current) {
        setLoadingList(false);
      }
    }
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (
      loadingMoreConversations ||
      !hasMoreConversations ||
      !nextConversationCursor
    ) {
      return;
    }
    const requestId = conversationListRequestRef.current;
    const query = searchRef.current;
    setLoadingMoreConversations(true);
    try {
      const page = await listConversations(query, nextConversationCursor);
      if (
        requestId !== conversationListRequestRef.current ||
        query !== searchRef.current
      ) {
        return;
      }
      setConversations((previous) => {
        const existing = new Set(previous.map((item) => item.id));
        return [
          ...previous,
          ...page.conversations.filter((item) => !existing.has(item.id)),
        ];
      });
      setHasMoreConversations(page.hasMore);
      setNextConversationCursor(page.nextCursor);
    } catch (error) {
      if (requestId === conversationListRequestRef.current) {
        toast.error(error instanceof Error ? error.message : "读取更多会话失败");
      }
    } finally {
      if (requestId === conversationListRequestRef.current) {
        setLoadingMoreConversations(false);
      }
    }
  }, [hasMoreConversations, loadingMoreConversations, nextConversationCursor]);

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

  const setTurnStopping = useCallback((turnId: string, value: boolean) => {
    const next = new Set(stoppingTurnIdsRef.current);
    if (value) next.add(turnId);
    else next.delete(turnId);
    stoppingTurnIdsRef.current = next;
    setStoppingTurnIds(next);
  }, []);

  const clearSettledStoppingTurns = useCallback((turns: Turn[]) => {
    const next = new Set(stoppingTurnIdsRef.current);
    let changed = false;
    for (const turn of turns) {
      if (turn.status !== "PENDING" && next.delete(turn.id)) changed = true;
    }
    if (!changed) return;
    stoppingTurnIdsRef.current = next;
    setStoppingTurnIds(next);
  }, []);

  const reconcileTurn = useCallback((turn: Turn) => {
    const cached = detailCacheRef.current.get(turn.conversationId);
    if (cached) {
      const next = replaceConversationTurn(cached, turn);
      if (next !== cached) cacheDetail(detailCacheRef.current, next);
    }
    setDetail((previous) => {
      if (!previous || previous.id !== turn.conversationId) return previous;
      const next = replaceConversationTurn(previous, turn);
      if (next !== previous) cacheDetail(detailCacheRef.current, next);
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
      setDetail(cached);
      setLoadingDetail(false);
    } else {
      setLoadingDetail(true);
    }

    try {
      const snapshot = await getConversation(id);
      if (activeIdRef.current === id) {
        const d = snapshot.conversation;
        setBalance(snapshot.balance);
        clearSettledStoppingTurns(d.turns);
        cacheDetail(detailCacheRef.current, d);
        setDetail(d);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取会话失败");
    } finally {
      if (activeIdRef.current === id) setLoadingDetail(false);
    }
  }, [clearSettledStoppingTurns, setCurrentActiveId]);

  const loadMoreTurns = useCallback(async () => {
    const current = detailRef.current;
    if (!current || !current.hasMore || !current.nextBefore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMoreTurns(true);
    try {
      const snapshot = await getConversation(current.id, {
        before: current.nextBefore,
        take: 20,
      });
      if (activeIdRef.current !== current.id) return;
      const older = snapshot.conversation;
      setBalance(snapshot.balance);
      clearSettledStoppingTurns(older.turns);

      setDetail((prev) => {
        if (!prev || prev.id !== current.id) return prev;
        const existing = new Set(prev.turns.map((turn) => turn.id));
        const olderTurns = older.turns.filter((turn) => !existing.has(turn.id));
        const next = {
          ...prev,
          turns: [...olderTurns, ...prev.turns],
          totalTurns: older.totalTurns,
          hasMore: olderTurns.length === 0 ? false : older.hasMore,
          nextBefore: olderTurns.length === 0 ? null : older.nextBefore,
        };
        cacheDetail(detailCacheRef.current, next);
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取更早记录失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreTurns(false);
    }
  }, [clearSettledStoppingTurns]);

  const hasPendingTurn = Boolean(
    detail?.turns.some((turn) => turn.status === "PENDING"),
  );
  useEffect(() => {
    if (!activeId || submitting || !hasPendingTurn) return;
    let disposed = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const snapshot = await getConversation(activeId);
        if (disposed || activeIdRef.current !== activeId) return;
        const current = snapshot.conversation;
        setBalance(snapshot.balance);
        clearSettledStoppingTurns(current.turns);
        setDetail((previous) => {
          if (!previous || previous.id !== activeId) return current;
          const next = mergeConversationSnapshot(previous, current);
          cacheDetail(detailCacheRef.current, next);
          return next;
        });
      } catch {
        // The active stream reports errors; background refresh retries quietly.
      } finally {
        polling = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [activeId, clearSettledStoppingTurns, hasPendingTurn, submitting]);

  const startNewDraft = useCallback(() => {
    setCurrentActiveId(null);
    setDetail(null);
  }, [setCurrentActiveId]);

  const requestTurnCancellation = useCallback(
    async (turnId: string, controller?: AbortController) => {
      if (stoppingTurnIdsRef.current.has(turnId)) return;
      setTurnStopping(turnId, true);
      if (controller) setStopping(true);
      let keepStopping = false;
      try {
        const result = await cancelTurn(turnId);
        reconcileTurn(result.turn);
        setBalance(result.balance);
        keepStopping = result.turn.status === "PENDING";
        const message = keepStopping ? "停止请求已提交" : "已停止生成";
        if (
          controller &&
          abortControllerRef.current === controller &&
          !controller.signal.aborted
        ) {
          controller.abort(message);
        } else {
          toast.info(message);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "停止生成失败");
      } finally {
        if (!keepStopping) setTurnStopping(turnId, false);
        if (controller && !controller.signal.aborted) setStopping(false);
      }
    },
    [reconcileTurn, setTurnStopping],
  );

  const stopGeneration = useCallback(() => {
    const controller = abortControllerRef.current;
    if (!controller || controller.signal.aborted) return;
    const turnId = activeTurnIdRef.current;
    if (!turnId) {
      toast.info("任务正在创建，请稍后再停止");
      return;
    }
    void requestTurnCancellation(turnId, controller);
  }, [requestTurnCancellation]);

  const stopTurn = useCallback(
    (turnId: string) => {
      const controller =
        activeTurnIdRef.current === turnId
          ? abortControllerRef.current ?? undefined
          : undefined;
      void requestTurnCancellation(turnId, controller);
    },
    [requestTurnCancellation],
  );

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
                modelSource: input.modelSource,
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
                modelSource: input.modelSource,
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
          toast.info(
            controller.signal.reason === "停止请求已提交"
              ? "停止请求已提交"
              : "已停止生成",
          );
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
      conversationListRequestRef.current += 1;
      setConversations([]);
      setHasMoreConversations(false);
      setNextConversationCursor(null);
      setLoadingList(false);
      setLoadingMoreConversations(false);
      setCurrentActiveId(null);
      setDetail(null);
      detailCacheRef.current.clear();
      stoppingTurnIdsRef.current = new Set();
      setStoppingTurnIds(new Set());
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
    loadingMoreConversations,
    hasMoreConversations,
    loadingDetail,
    loadingMoreTurns,
    submitting,
    stopping,
    stoppingTurnIds,
    balance,
    selectConversation,
    loadMoreConversations,
    loadMoreTurns,
    startNewDraft,
    submit,
    stopGeneration,
    stopTurn,
    rename,
    remove,
    clearAll,
  };
}
