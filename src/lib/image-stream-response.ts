import {
  streamImageTurn,
  type ImageTurnProgressEvent,
  type SerializedTurn,
} from "@/lib/image-workbench";

type StreamEvent =
  | ImageTurnProgressEvent
  | { type: "error"; status: number; error: string };

export function createImageTurnStreamResponse(
  turn: SerializedTurn,
  signal: AbortSignal,
) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const enqueue = (event: StreamEvent) => {
        if (closed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await streamImageTurn(turn, enqueue, signal);
      } catch (error) {
        enqueue({
          type: "error",
          status: 500,
          error: error instanceof Error ? error.message : "读取图片任务进度失败",
        });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            closed = true;
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
