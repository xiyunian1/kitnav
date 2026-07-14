import { describe, expect, it, vi } from "vitest";
import {
  assertSafePublicApiUrl,
  assertSafePublicUrl,
  fetchPublicApi,
  fetchPublicResource,
  readBoundedJsonResponse,
} from "./safe-fetch";

describe("safe public resource fetching", () => {
  it.each([
    "http://127.0.0.1/image.png",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.1/image.png",
    "http://[::1]/image.png",
    "http://[::ffff:7f00:1]/image.png",
    "http://[::ffff:a00:1]/image.png",
  ])("rejects local, link-local, and private addresses: %s", async (url) => {
    await expect(assertSafePublicUrl(url)).rejects.toThrow();
  });

  it.each([
    "http://93.184.216.34/v1",
    "https://user:password@93.184.216.34/v1",
    "https://127.0.0.1/v1",
  ])("rejects unsafe user API endpoints: %s", async (url) => {
    await expect(assertSafePublicApiUrl(url)).rejects.toThrow();
  });

  it("allows public HTTPS API endpoints", async () => {
    await expect(
      assertSafePublicApiUrl("https://93.184.216.34/v1"),
    ).resolves.toBeInstanceOf(URL);
  });

  it("does not follow user API redirects", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(null, {
          status: 307,
          headers: { Location: "https://93.184.216.35/v1" },
        });
      },
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      fetchPublicApi(
        "https://93.184.216.34/v1/chat/completions",
        { headers: { Authorization: "Bearer secret" } },
        { fetchImpl },
      ),
    ).rejects.toThrow("不允许重定向");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("validates redirect targets before following them", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/private.png" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      fetchPublicResource("https://93.184.216.34/image.png", {
        maxBytes: 1024,
        fetchImpl,
      }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops reading a response as soon as it exceeds the byte limit", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4, 5])),
    ) as unknown as typeof fetch;

    await expect(
      fetchPublicResource("https://93.184.216.34/image.png", {
        maxBytes: 4,
        fetchImpl,
      }),
    ).rejects.toThrow("资源文件过大");
  });

  it("returns a bounded public response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      }),
    ) as unknown as typeof fetch;

    const result = await fetchPublicResource("https://93.184.216.34/image.png", {
      maxBytes: 4,
      fetchImpl,
    });
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(result.contentType).toBe("image/png");
  });

  it("bounds JSON API responses while streaming", async () => {
    const response = new Response('{"value":"too long"}');
    await expect(readBoundedJsonResponse(response, 4)).rejects.toThrow(
      "响应过大",
    );
  });
});
