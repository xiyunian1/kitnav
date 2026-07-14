import { assertDatabaseReady } from "@/lib/database-readiness";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await assertDatabaseReady();
    return Response.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("health", "数据库就绪检查失败", { error });
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
