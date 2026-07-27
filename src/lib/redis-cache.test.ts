import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisMock = vi.fn();
const markRedisUnhealthyMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  getRedis: (...args: unknown[]) => getRedisMock(...args),
  markRedisUnhealthy: (...args: unknown[]) => markRedisUnhealthyMock(...args),
}));

import { cachedJson, invalidateCache } from "./redis-cache";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cachedJson", () => {
  it("calls the loader directly when Redis is absent", async () => {
    getRedisMock.mockReturnValue(null);
    const loader = vi.fn().mockResolvedValue({ a: 1 });

    await expect(cachedJson("cache:test", 30, loader)).resolves.toEqual({ a: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("returns the cached value without invoking the loader", async () => {
    getRedisMock.mockReturnValue({
      get: vi.fn().mockResolvedValue('{"a":2}'),
      set: vi.fn(),
    });
    const loader = vi.fn();

    await expect(cachedJson("cache:test", 30, loader)).resolves.toEqual({ a: 2 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("stores the loader result with a TTL on cache miss", async () => {
    const setMock = vi.fn().mockResolvedValue("OK");
    getRedisMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      set: setMock,
    });
    const loader = vi.fn().mockResolvedValue({ a: 3 });

    await expect(cachedJson("cache:test", 30, loader)).resolves.toEqual({ a: 3 });
    expect(setMock).toHaveBeenCalledWith("cache:test", '{"a":3}', "EX", 30);
  });

  it("falls back to the loader when GET fails", async () => {
    getRedisMock.mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error("down")),
      set: vi.fn(),
    });
    const loader = vi.fn().mockResolvedValue({ a: 4 });

    await expect(cachedJson("cache:test", 30, loader)).resolves.toEqual({ a: 4 });
    expect(markRedisUnhealthyMock).toHaveBeenCalledTimes(1);
  });

  it("still returns the value when the cache write fails", async () => {
    getRedisMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error("down")),
    });

    await expect(
      cachedJson("cache:test", 30, async () => ({ a: 5 })),
    ).resolves.toEqual({ a: 5 });
    expect(markRedisUnhealthyMock).toHaveBeenCalledTimes(1);
  });
});

describe("invalidateCache", () => {
  it("deletes the given keys", async () => {
    const delMock = vi.fn().mockResolvedValue(1);
    getRedisMock.mockReturnValue({ del: delMock });

    await invalidateCache("cache:a", "cache:b");
    expect(delMock).toHaveBeenCalledWith("cache:a", "cache:b");
  });

  it("is a no-op without Redis and tolerates DEL failures", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(invalidateCache("cache:a")).resolves.toBeUndefined();

    getRedisMock.mockReturnValue({
      del: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(invalidateCache("cache:a")).resolves.toBeUndefined();
    expect(markRedisUnhealthyMock).toHaveBeenCalledTimes(1);
  });
});
