import { beforeEach, describe, expect, it, vi } from "vitest";

const getRedisMock = vi.fn();
const markRedisUnhealthyMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  getRedis: (...args: unknown[]) => getRedisMock(...args),
  markRedisUnhealthy: (...args: unknown[]) => markRedisUnhealthyMock(...args),
}));

const queryRawMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    rateLimitBucket: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));

import { rateLimitCheck } from "./rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rateLimitCheck", () => {
  it("uses the Postgres bucket when Redis is not configured", async () => {
    getRedisMock.mockReturnValue(null);
    queryRawMock.mockResolvedValue([
      { count: 3, expiresAt: new Date(Date.now() + 60_000) },
    ]);

    const result = await rateLimitCheck("login:ip:1.2.3.4", 10, 60_000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(7);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("counts through Redis when available and skips the database", async () => {
    const evalMock = vi.fn().mockResolvedValue([11, 42_000]);
    getRedisMock.mockReturnValue({ eval: evalMock });

    const result = await rateLimitCheck("login:ip:1.2.3.4", 10, 60_000);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(42_000);
    expect(result.remaining).toBe(0);
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("INCR"),
      1,
      "rl:login:ip:1.2.3.4",
      "60000",
    );
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when the Redis command fails", async () => {
    getRedisMock.mockReturnValue({
      eval: vi.fn().mockRejectedValue(new Error("connection refused")),
    });
    queryRawMock.mockResolvedValue([
      { count: 1, expiresAt: new Date(Date.now() + 60_000) },
    ]);

    const result = await rateLimitCheck("login:ip:1.2.3.4", 10, 60_000);

    expect(result.allowed).toBe(true);
    expect(markRedisUnhealthyMock).toHaveBeenCalledTimes(1);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid keys, limits, and windows", async () => {
    getRedisMock.mockReturnValue(null);
    await expect(rateLimitCheck("", 10, 60_000)).rejects.toThrow("无效的限流标识");
    await expect(rateLimitCheck("k", 0, 60_000)).rejects.toThrow("正整数");
    await expect(rateLimitCheck("k", 10, 500)).rejects.toThrow("1000ms");
    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
