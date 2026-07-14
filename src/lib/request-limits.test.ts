import { afterEach, describe, expect, it, vi } from "vitest";

const { rateLimitCheck, rateLimitResponse } = vi.hoisted(() => ({
  rateLimitCheck: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

vi.mock("@/lib/rate-limit", () => ({
  getRequestIp: (request: Request) => request.headers.get("x-forwarded-for"),
  rateLimitCheck,
  rateLimitResponse,
}));

import {
  enforceIpRequestLimit,
  enforceOpaqueValueLimit,
  enforceUserRequestLimit,
  REQUEST_LIMITS,
} from "./request-limits";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.IMAGE_GENERATE_RATE_MAX;
  delete process.env.IMAGE_GENERATE_RATE_WINDOW_MS;
  delete process.env.PPT_GENERATE_RATE_MAX;
  delete process.env.PPT_GENERATE_RATE_WINDOW_MS;
  delete process.env.PPT_UPLOAD_RATE_MAX;
  delete process.env.PPT_UPLOAD_RATE_WINDOW_MS;
});

describe("configured request limits", () => {
  it("uses the configured user limit", async () => {
    process.env.IMAGE_GENERATE_RATE_MAX = "7";
    process.env.IMAGE_GENERATE_RATE_WINDOW_MS = "9000";
    rateLimitCheck.mockResolvedValue({
      allowed: true,
      retryAfterMs: 0,
      remaining: 6,
    });

    await expect(
      enforceUserRequestLimit("user-1", REQUEST_LIMITS.imageGenerate),
    ).resolves.toBeNull();
    expect(rateLimitCheck).toHaveBeenCalledWith(
      "image-generate:u:user-1",
      7,
      9000,
    );
  });

  it("returns a 429 response when an IP bucket is exhausted", async () => {
    rateLimitCheck.mockResolvedValue({
      allowed: false,
      retryAfterMs: 1000,
      remaining: 0,
    });
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    const response = await enforceIpRequestLimit(request, REQUEST_LIMITS.login);
    expect(response?.status).toBe(429);
    expect(rateLimitCheck).toHaveBeenCalledWith(
      "auth-login:ip:203.0.113.9",
      10,
      300000,
    );
    expect(rateLimitResponse).toHaveBeenCalledOnce();
  });

  it("falls back when PPT rate limit settings are invalid", async () => {
    process.env.PPT_GENERATE_RATE_MAX = "invalid";
    process.env.PPT_GENERATE_RATE_WINDOW_MS = "500";
    process.env.PPT_UPLOAD_RATE_MAX = "1.5";
    process.env.PPT_UPLOAD_RATE_WINDOW_MS = "9999999999";
    rateLimitCheck.mockResolvedValue({
      allowed: true,
      retryAfterMs: 0,
      remaining: 9,
    });

    await enforceUserRequestLimit("user-2", REQUEST_LIMITS.pptGenerate);
    await enforceUserRequestLimit("user-2", REQUEST_LIMITS.pptUpload);

    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      1,
      "ppt-generate:u:user-2",
      10,
      60_000,
    );
    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      2,
      "ppt-upload:u:user-2",
      20,
      60_000,
    );
  });

  it("hashes sensitive values before using them as database keys", async () => {
    rateLimitCheck.mockResolvedValue({
      allowed: true,
      retryAfterMs: 0,
      remaining: 4,
    });
    await enforceOpaqueValueLimit("private@example.com", REQUEST_LIMITS.register);

    const key = rateLimitCheck.mock.calls[0]?.[0] as string;
    expect(key).toMatch(/^register:v:[0-9a-f]{64}$/);
    expect(key).not.toContain("private@example.com");
  });
});
