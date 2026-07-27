import Redis from "ioredis";
import { logger } from "@/lib/logger";

/**
 * 可选 Redis 接入：仅当设置了 REDIS_URL 时启用。
 *
 * 设计目标是"加速但不增加故障面"：Redis 缺席或不可用时，调用方必须能
 * 无感回退到既有的 Postgres/内存实现，因此这里提供的是"尽力而为"的客户端——
 *  - enableOfflineQueue=false + maxRetriesPerRequest=1：Redis 掉线时命令立即失败，
 *    由调用方走回退路径，而不是把请求挂在重连队列里拖慢接口。
 *  - 命令失败后进入 30s 熔断窗口，窗口内 getRedis() 返回 null，避免每个请求
 *    都等待一次连接超时。
 */

const UNHEALTHY_BACKOFF_MS = 30_000;
const LOG_INTERVAL_MS = 60_000;

interface RedisRuntime {
  client: Redis | undefined;
  unhealthyUntil: number;
  lastWarnAt: number;
}

const globalForRedis = globalThis as unknown as {
  redisRuntime: RedisRuntime | undefined;
};

const runtime: RedisRuntime = globalForRedis.redisRuntime ?? {
  client: undefined,
  unhealthyUntil: 0,
  lastWarnAt: 0,
};
globalForRedis.redisRuntime = runtime;

export function isRedisConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return Boolean(env.REDIS_URL?.trim());
}

function warnThrottled(message: string, error: unknown) {
  const now = Date.now();
  if (now - runtime.lastWarnAt < LOG_INTERVAL_MS) return;
  runtime.lastWarnAt = now;
  logger.warn("redis", message, { error });
}

function createClient(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 1_000, 15_000),
  });
  // ioredis 在断线时会持续 emit error；不监听会变成 unhandled error。
  client.on("error", (error) => {
    warnThrottled("Redis 连接异常，相关功能将回退到数据库实现", error);
  });
  return client;
}

/**
 * 返回可用的 Redis 客户端；未配置、连接未就绪或处于熔断窗口时返回 null。
 * 调用方拿到 null 时应直接走回退实现。
 *
 * 说明：enableOfflineQueue=false 下，连接未就绪时发出的命令会被立即拒绝，
 * 因此这里只在 status === "ready" 时把客户端交给调用方；首次访问触发
 * 异步建连，建连期间的请求自然走数据库路径。
 */
export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (Date.now() < runtime.unhealthyUntil) return null;
  if (!runtime.client) {
    runtime.client = createClient(url);
  }
  const client = runtime.client;
  if (client.status === "ready") return client;
  if (client.status === "wait") {
    // 连接失败由 error 事件统一记录并限频。
    void client.connect().catch(() => undefined);
  }
  return null;
}

/**
 * 命令失败后调用：进入熔断窗口，期间 getRedis() 返回 null。
 */
export function markRedisUnhealthy(error: unknown) {
  runtime.unhealthyUntil = Date.now() + UNHEALTHY_BACKOFF_MS;
  warnThrottled("Redis 命令失败，30 秒内回退到数据库实现", error);
}

export interface RedisHealthInfo {
  configured: boolean;
  healthy: boolean;
  latencyMs: number | null;
}

/** 运维指标用：PING 实测延迟。未配置时 configured=false。 */
export async function redisHealthInfo(): Promise<RedisHealthInfo> {
  if (!isRedisConfigured()) {
    return { configured: false, healthy: false, latencyMs: null };
  }
  const client = getRedis();
  if (!client) return { configured: true, healthy: false, latencyMs: null };
  const startedAt = Date.now();
  try {
    await client.ping();
    return {
      configured: true,
      healthy: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    markRedisUnhealthy(error);
    return { configured: true, healthy: false, latencyMs: null };
  }
}
