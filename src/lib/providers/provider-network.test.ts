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

  it("keeps the legacy image field for a single edit reference", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ data: [{ url: "https://cdn.example.com/edited.png" }] }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "legacy-edit-model",
      networkPolicy: "public",
    });

    await provider.edit({
      prompt: "edit",
      images: [{ blob: new Blob(["one"], { type: "image/png" }), filename: "one.png" }],
    });
    const body = mocks.request.mock.calls[0]?.[1]?.body as FormData;
    expect(body.getAll("image")).toHaveLength(1);
    expect(body.getAll("image[]")).toHaveLength(0);
  });

  it("sends every multi-image edit reference as ordered image[] fields", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ data: [{ url: "https://cdn.example.com/edited.png" }] }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "gpt-image-2",
      networkPolicy: "public",
    });

    await provider.edit({
      prompt: "combine",
      images: [
        { blob: new Blob(["first"], { type: "image/png" }), filename: "01.png" },
        { blob: new Blob(["second"], { type: "image/png" }), filename: "02.png" },
        { blob: new Blob(["third"], { type: "image/png" }), filename: "03.png" },
      ],
    });
    const body = mocks.request.mock.calls[0]?.[1]?.body as FormData;
    const images = body.getAll("image[]") as File[];
    expect(images.map((image) => image.name)).toEqual(["01.png", "02.png", "03.png"]);
    expect(await Promise.all(images.map((image) => image.text()))).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(body.getAll("image")).toHaveLength(0);
    expect(body.has("input_fidelity")).toBe(false);
  });

  it("returns a clear error when an upstream rejects native multi-image fields", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ error: { message: "unknown field image[]" } }, { status: 400 }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "gpt-image-2",
      networkPolicy: "public",
    });

    await expect(
      provider.edit({
        prompt: "combine",
        images: [
          { blob: new Blob(["first"]), filename: "01.png" },
          { blob: new Blob(["second"]), filename: "02.png" },
        ],
      }),
    ).rejects.toThrow("未接受 2 张参考图");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("supports sixteen ordered upstream references and rejects a seventeenth", async () => {
    mocks.request.mockResolvedValue(
      Response.json({ data: [{ url: "https://cdn.example.com/edited.png" }] }),
    );
    const provider = new OpenAIImageProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret",
      model: "gpt-image-2",
      networkPolicy: "public",
    });
    const images = Array.from({ length: 16 }, (_, index) => ({
      blob: new Blob([String(index)], { type: "image/png" }),
      filename: `${String(index + 1).padStart(2, "0")}.png`,
    }));

    await provider.edit({ prompt: "combine", images });
    const body = mocks.request.mock.calls[0]?.[1]?.body as FormData;
    expect(
      (body.getAll("image[]") as File[]).map((image) => image.name),
    ).toEqual(images.map((image) => image.filename));

    await expect(
      provider.edit({
        prompt: "too many",
        images: [...images, { blob: new Blob(["17"]), filename: "17.png" }],
      }),
    ).rejects.toThrow("最多上传 16 张");
    expect(mocks.request).toHaveBeenCalledTimes(1);
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
