import { getRedis, markRedisUnhealthy } from "@/lib/redis";

/**
 * 基于 Redis 的 JSON 读穿缓存。Redis 未配置、熔断中或命令失败时，
 * 直接执行 loader 查库——缓存永远只是加速层，不参与正确性。
 */
export async function cachedJson<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  if (!redis) return loader();

  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (error) {
    markRedisUnhealthy(error);
    return loader();
  }

  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (error) {
    // 写缓存失败不影响本次结果，标记后由后续请求回退。
    markRedisUnhealthy(error);
  }
  return value;
}

/** 删除缓存键（配置变更后调用）。Redis 缺席时为 no-op。 */
export async function invalidateCache(...keys: string[]) {
  if (keys.length === 0) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(...keys);
  } catch (error) {
    // 失效失败可容忍：条目会在 TTL 内过期。
    markRedisUnhealthy(error);
  }
}

export const CACHE_KEYS = {
  settingsAll: "cache:settings:all",
  activeAnnouncements: "cache:announcements:active",
} as const;

/** 设置表（含模块开关）的统一缓存 TTL；失效遗漏时的最大陈旧窗口。 */
export const SETTINGS_CACHE_TTL_SECONDS = 30;
