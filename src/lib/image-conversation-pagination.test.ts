import { describe, expect, it } from "vitest";
import {
  decodeImageConversationCursor,
  encodeImageConversationCursor,
  parseImageConversationPageSize,
} from "./image-conversation-pagination";

describe("image conversation pagination", () => {
  it("round-trips a stable cursor", () => {
    const updatedAt = new Date("2026-07-12T08:30:00.000Z");
    const encoded = encodeImageConversationCursor({
      updatedAt,
      id: "conversation_123",
    });
    expect(decodeImageConversationCursor(encoded)).toEqual({
      updatedAt,
      id: "conversation_123",
    });
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeImageConversationCursor("not-json")).toThrow(
      "会话分页游标无效",
    );
    expect(() =>
      decodeImageConversationCursor(
        Buffer.from(
          JSON.stringify({ version: 2, updatedAt: "invalid", id: "" }),
        ).toString("base64url"),
      ),
    ).toThrow("会话分页游标无效");
  });

  it("bounds page sizes", () => {
    expect(parseImageConversationPageSize("20")).toBe(20);
    expect(parseImageConversationPageSize("0")).toBe(50);
    expect(parseImageConversationPageSize("101")).toBe(50);
    expect(parseImageConversationPageSize("1.5")).toBe(50);
  });
});
