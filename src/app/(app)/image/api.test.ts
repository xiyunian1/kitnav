import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelTurn, editTurn, editTurnStream, getConversation } from "./api";

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

  it("submits every edit image in order using repeated images fields", async () => {
    const first = new File(["first"], "01.png", { type: "image/png" });
    const second = new File(["second"], "02.webp", { type: "image/webp" });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const images = form.getAll("images") as File[];
      expect(images.map((image) => image.name)).toEqual(["01.png", "02.webp"]);
      expect(await Promise.all(images.map((image) => image.text()))).toEqual([
        "first",
        "second",
      ]);
      expect(form.has("image")).toBe(false);
      expect(form.has("referenceThumb")).toBe(false);
      return Response.json({ turn, conversationId: conversation.id });
    });
    vi.stubGlobal("fetch", fetchMock);

    await editTurn({
      prompt: "edit",
      ratio: "1:1",
      count: 1,
      images: [first, second],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/image/turns/edit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves image order in the streaming edit request", async () => {
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const names = (init?.body as FormData)
          .getAll("images")
          .map((entry) => (entry as File).name);
        expect(names).toEqual(["a.png", "b.png"]);
        return new Response(
          `${JSON.stringify({ type: "final", turn, conversationId: conversation.id })}\n`,
        );
      }),
    );

    const events: unknown[] = [];
    await editTurnStream(
      { prompt: "edit", ratio: "1:1", count: 1, images: [first, second] },
      (event) => events.push(event),
    );
    expect(events).toHaveLength(1);
  });
});
