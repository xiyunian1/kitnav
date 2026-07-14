import { timingSafeEqual } from "node:crypto";
import {
  collectOperationalMetrics,
  renderOperationalMetrics,
} from "@/lib/operational-metrics";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.METRICS_TOKEN;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const actual = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function GET(request: Request) {
  if (!process.env.METRICS_TOKEN) {
    return Response.json(
      { error: "Metrics are not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!authorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }
  try {
    const body = renderOperationalMetrics(await collectOperationalMetrics());
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    logger.error("metrics", "运维指标采集失败", { error });
    return Response.json(
      { error: "Metrics unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
