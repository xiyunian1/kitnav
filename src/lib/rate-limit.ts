/**
 * 进程内滑动窗口限流。
 *
 * 用于保护易被滥用的写接口（PPT 生成、API 配置连通性测试、文件上传）。
 * 单进程实现：在 next start 进程内维护每个 key（用户 id 或 IP）的请求时间戳，
 * 滑动窗口内超过上限即拒绝。与 PPT 生成的进程内信号量一致，多副本时每副本各自计数
 * （如需跨副本硬限流，后续可改为 Postgres 计数表）。
 *
 * key 空间有限（用户数 + IP），但仍定期清理空桶以防内存缓慢增长。
 */

interface Bucket {
	timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface RateLimitResult {
	allowed: boolean;
	/** 距离下次允许请求还需等待的毫秒数（被拒绝时 > 0）。 */
	retryAfterMs: number;
	remaining: number;
}

/**
 * 检查某个 key 在窗口内是否仍允许请求。
 * @param max   窗口内最大允许次数
 * @param windowMs 窗口长度（毫秒）
 */
export function rateLimitCheck(
	key: string,
	max: number,
	windowMs: number,
): RateLimitResult {
	const now = Date.now();
	const cutoff = now - windowMs;
	const bucket = buckets.get(key);
	if (!bucket) {
		buckets.set(key, { timestamps: [now] });
		return { allowed: true, retryAfterMs: 0, remaining: max - 1 };
	}
	bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
	if (bucket.timestamps.length >= max) {
		const oldest = bucket.timestamps[0];
		return {
			allowed: false,
			retryAfterMs: Math.max(1, oldest + windowMs - now),
			remaining: 0,
		};
	}
	bucket.timestamps.push(now);
	return {
		allowed: true,
		retryAfterMs: 0,
		remaining: max - bucket.timestamps.length,
	};
}

/**
 * 构造 429 响应。带 Retry-After（秒）与 RFC 草案的 RateLimit-* 头。
 */
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

// 定期清理空桶，防止 key 空间缓慢膨胀。
setInterval(() => {
	const cutoff = Date.now() - SWEEP_INTERVAL_MS;
	for (const [key, bucket] of buckets) {
		bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
		if (bucket.timestamps.length === 0) buckets.delete(key);
	}
}, SWEEP_INTERVAL_MS).unref();
