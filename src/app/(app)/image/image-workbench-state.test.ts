import { describe, expect, it } from "vitest";
import {
  mergeConversationSnapshot,
  replaceConversationTurn,
} from "./image-workbench-state";
import type { ConversationDetail, Turn, TurnStatus } from "./types";

function createTurn(id: string, status: TurnStatus): Turn {
  return {
    id,
    conversationId: "conversation-1",
    prompt: `prompt-${id}`,
    mode: "generate",
    model: "image-model",
    providerSource: "platform",
    ratio: "1:1",
    count: 1,
    status,
    images: [{ id: "0", status: status === "PENDING" ? "loading" : "success" }],
    referenceThumbs: [],
    error: null,
    creditsCost: status === "PENDING" ? 10 : 5,
    usedOwnKey: false,
    createdAt: `2026-07-14T00:00:0${id}.000Z`,
  };
}

function createDetail(turns: Turn[]): ConversationDetail {
  return {
    id: "conversation-1",
    title: "conversation",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    turns,
    totalTurns: turns.length,
    hasMore: false,
    nextBefore: null,
  };
}

describe("image workbench state", () => {
  it("replaces only the requested turn", () => {
    const first = createTurn("1", "PENDING");
    const second = createTurn("2", "PENDING");
    const replacement = createTurn("1", "FAILED");

    const result = replaceConversationTurn(createDetail([first, second]), replacement);

    expect(result.turns).toEqual([replacement, second]);
    expect(result.turns[1]).toBe(second);
  });

  it("merges polled turns while preserving previously loaded history", () => {
    const older = createTurn("1", "SUCCESS");
    const pending = createTurn("2", "PENDING");
    const completed = createTurn("2", "SUCCESS");
    const newest = createTurn("3", "PENDING");
    const previous = createDetail([older, pending]);
    const current = {
      ...createDetail([completed, newest]),
      updatedAt: "2026-07-14T00:01:00.000Z",
      totalTurns: 3,
    };

    const result = mergeConversationSnapshot(previous, current);

    expect(result.turns).toEqual([older, completed, newest]);
    expect(result.totalTurns).toBe(3);
    expect(result.updatedAt).toBe(current.updatedAt);
  });
});
