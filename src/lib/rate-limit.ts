import { prisma } from "@/lib/db";

export interface RateLimitResult {
	allowed: boolean;
	/** 距离下次允许请求还需等待的毫秒数（被拒绝时 > 0）。 */
	retryAfterMs: number;
	remaining: number;
}

let checksSinceCleanup = 0;

/**
 * 使用 PostgreSQL UPSERT 的跨进程固定窗口限流。
 * 同一 key 的并发请求由数据库行锁串行计数，Web 重启和多副本不会绕过限制。
 */
export async function rateLimitCheck(
	key: string,
	max: number,
	windowMs: number,
): Promise<RateLimitResult> {
	if (!key || key.length > 300) throw new Error("无效的限流标识。");
	if (!Number.isSafeInteger(max) || max < 1) {
		throw new Error("限流次数必须是正整数。");
	}
	if (!Number.isSafeInteger(windowMs) || windowMs < 1_000) {
		throw new Error("限流窗口必须至少为 1000ms。");
	}

	const now = new Date();
	const nextExpiry = new Date(now.getTime() + windowMs);
	const [bucket] = await prisma.$queryRaw<
		Array<{ count: number; expiresAt: Date }>
	>`
    INSERT INTO "RateLimitBucket" (
      "key", "windowStartedAt", "count", "expiresAt"
    )
    VALUES (${key}, ${now}, 1, ${nextExpiry})
    ON CONFLICT ("key") DO UPDATE SET
      "windowStartedAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now}
          THEN ${now}
        ELSE "RateLimitBucket"."windowStartedAt"
      END,
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now}
          THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= ${now}
          THEN ${nextExpiry}
        ELSE "RateLimitBucket"."expiresAt"
      END
    RETURNING "count", "expiresAt"
  `;
	if (!bucket) throw new Error("限流计数失败。");

	checksSinceCleanup += 1;
	if (checksSinceCleanup >= 100) {
		checksSinceCleanup = 0;
		void prisma.rateLimitBucket
			.deleteMany({ where: { expiresAt: { lt: now } } })
			.catch(() => undefined);
	}

	const allowed = bucket.count <= max;
	return {
		allowed,
		retryAfterMs: allowed
			? 0
			: Math.max(1, bucket.expiresAt.getTime() - Date.now()),
		remaining: Math.max(0, max - bucket.count),
	};
}

/** 构造 429 响应，并告知客户端最早重试时间。 */
export function rateLimitResponse(
	result: RateLimitResult,
	message = "请求过于频繁，请稍后再试",
): Response {
	return Response.json(
		{ error: message },
		{
			status: 429,
			headers: {
				"Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
			},
		},
	);
}

/** 限流 key：登录用户用其 id，未登录用 IP。 */
export function resolveRateLimitKey(
	prefix: string,
	userId: string | null,
	ip: string | null,
): string {
	if (userId) return `${prefix}:u:${userId}`;
	return `${prefix}:ip:${ip ?? "unknown"}`;
}

export function getRequestIp(req: Request): string | null {
	const forwarded = req.headers.get("x-forwarded-for");
	if (forwarded) return forwarded.split(",")[0]?.trim() || null;
	return req.headers.get("x-real-ip") || null;
}
