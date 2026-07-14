import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelTurn, getConversation } from "./api";

const conversation = {
  id: "conversation-1",
  title: "conversation",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  turns: [],
  totalTurns: 0,
  hasMore: false,
  nextBefore: null,
};

const turn = {
  id: "turn-1",
  conversationId: "conversation-1",
  prompt: "prompt",
  mode: "generate",
  model: "image-model",
  providerSource: "platform",
  ratio: "1:1",
  count: 1,
  status: "FAILED",
  images: [{ id: "0", status: "error", error: "用户已停止生成" }],
  referenceThumbs: [],
  error: "用户已停止生成",
  creditsCost: 0,
  usedOwnKey: false,
  createdAt: "2026-07-14T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image workbench API", () => {
  it("returns the authoritative balance with a conversation snapshot", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ conversation, balance: 75 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getConversation("conversation-1")).resolves.toEqual({
      conversation,
      balance: 75,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/image/conversations/conversation-1?take=8",
    );
  });

  it("returns the authoritative balance after cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ turn, balance: 100 })),
    );

    await expect(cancelTurn("turn-1")).resolves.toEqual({
      turn,
      balance: 100,
    });
  });

  it("rejects malformed balance responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ conversation, balance: "75" })),
    );

    await expect(getConversation("conversation-1")).rejects.toThrow(
      "积分余额响应无效",
    );
  });
});
