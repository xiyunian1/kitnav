import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTurnSchema } from "@/lib/image-schema";
import { enqueueImageTurn, TurnError } from "@/lib/image-workbench";
import { createImageTurnStreamResponse } from "@/lib/image-stream-response";
import {
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "@/lib/request-limits";
import {
  JSON_BODY_LIMITS,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "@/lib/json-request";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }
  const userId = session.user.id;
  const limited = await enforceUserRequestLimit(
    userId,
    REQUEST_LIMITS.imageGenerate,
  );
  if (limited) return limited;

  let raw: unknown;
  try {
    raw = await readLimitedJsonBody(req, JSON_BODY_LIMITS.standard);
  } catch (error) {
    const bodyError = jsonRequestErrorDetails(error);
    return NextResponse.json(
      { error: bodyError.message },
      { status: bodyError.status },
    );
  }

  const parsed = generateTurnSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "参数错误" },
      { status: 400 }
    );
  }

  try {
    const turn = await enqueueImageTurn({
      userId,
      conversationId: parsed.data.conversationId,
      prompt: parsed.data.prompt,
      ratio: parsed.data.ratio,
      quality: parsed.data.quality,
      count: parsed.data.count,
      model: parsed.data.model,
      modelSource: parsed.data.modelSource,
      mode: "generate",
    });
    return createImageTurnStreamResponse(turn, req.signal);
  } catch (error) {
    const status = error instanceof TurnError ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成失败" },
      { status },
    );
  }
}
