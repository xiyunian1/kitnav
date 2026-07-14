import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("./network", () => ({
  fetchProviderEndpoint: mocks.request,
}));

import { OpenAIImageProvider } from "./image-openai";
import { listModels } from "./list-models";
import { OpenAITextProvider } from "./text-openai";

describe("provider transport wiring", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("passes public policy through image generation", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ data: [{ url: "https://cdn.example.com/image.png" }] }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "image-model",
      networkPolicy: "public",
    });

    await expect(provider.generate({ prompt: "test" })).resolves.toEqual({
      urls: ["https://cdn.example.com/image.png"],
      elapsedMs: expect.any(Number),
    });
    expect(mocks.request.mock.calls[0]?.[2]).toBe("public");
  });

  it("passes trusted policy through text generation", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ choices: [{ message: { content: "OK" } }] }),
    );
    const provider = new OpenAITextProvider({
      baseUrl: "http://platform-api:8080/v1",
      apiKey: "secret",
      model: "text-model",
      networkPolicy: "trusted",
    });

    await expect(
      provider.generateText({ messages: [{ role: "user", content: "test" }] }),
    ).resolves.toBe("OK");
    expect(mocks.request.mock.calls[0]?.[2]).toBe("trusted");
  });

  it("passes public policy through model discovery", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ data: [{ id: "model-b" }, { id: "model-a" }] }),
    );

    await expect(
      listModels({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        networkPolicy: "public",
      }),
    ).resolves.toEqual({ ok: true, models: ["model-a", "model-b"] });
    expect(mocks.request.mock.calls[0]?.[2]).toBe("public");
  });

  it("rejects local relative image results from an upstream", async () => {
    mocks.request.mockResolvedValue(
      Response.json({
        data: [{ url: "/api/files/materials/another-user/private.png" }],
      }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "image-model",
      networkPolicy: "public",
    });

    await expect(provider.generate({ prompt: "test" })).rejects.toThrow(
      "无效的图片 URL",
    );
  });

  it("rejects an oversized model list response", async () => {
    mocks.request.mockResolvedValue(
      new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
    );

    await expect(
      listModels({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
      }),
    ).resolves.toEqual({ ok: false, error: "上游模型列表响应过大" });
  });
});
