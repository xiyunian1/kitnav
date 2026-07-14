import type { ConversationDetail, Turn } from "./types";

export function replaceConversationTurn(
  detail: ConversationDetail,
  turn: Turn,
): ConversationDetail {
  if (detail.id !== turn.conversationId) return detail;
  const index = detail.turns.findIndex((item) => item.id === turn.id);
  if (index === -1) return detail;
  const turns = [...detail.turns];
  turns[index] = turn;
  return { ...detail, turns };
}

export function mergeConversationSnapshot(
  previous: ConversationDetail,
  current: ConversationDetail,
): ConversationDetail {
  if (previous.id !== current.id) return current;
  const incoming = new Map(current.turns.map((turn) => [turn.id, turn]));
  const existingIds = new Set(previous.turns.map((turn) => turn.id));
  const turns = previous.turns.map((turn) => incoming.get(turn.id) ?? turn);
  for (const turn of current.turns) {
    if (!existingIds.has(turn.id)) turns.push(turn);
  }
  return {
    ...previous,
    updatedAt: current.updatedAt,
    turns,
    totalTurns: current.totalTurns,
  };
}
