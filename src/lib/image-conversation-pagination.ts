const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;

export interface ImageConversationCursor {
  updatedAt: Date;
  id: string;
}

export function encodeImageConversationCursor(input: ImageConversationCursor) {
  return Buffer.from(
    JSON.stringify({
      version: CURSOR_VERSION,
      updatedAt: input.updatedAt.toISOString(),
      id: input.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeImageConversationCursor(
  value: string | null,
): ImageConversationCursor | null {
  if (!value) return null;
  if (
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error("会话分页游标无效");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("会话分页游标无效");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("会话分页游标无效");
  }
  const record = parsed as Record<string, unknown>;
  const updatedAt = new Date(String(record.updatedAt ?? ""));
  const id = typeof record.id === "string" ? record.id : "";
  if (
    record.version !== CURSOR_VERSION ||
    Number.isNaN(updatedAt.getTime()) ||
    !id ||
    id.length > 100
  ) {
    throw new Error("会话分页游标无效");
  }
  return { updatedAt, id };
}

export function parseImageConversationPageSize(
  value: string | null,
  fallback = 50,
  max = 100,
) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max
    ? parsed
    : fallback;
}
