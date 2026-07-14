import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAITextProvider } from "./text-openai";

describe("provider network policy integration", () => {
  let server: Server;
  let port = 0;
  let requests = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1;
      request.resume();
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
        );
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("无法启动 Provider 网络策略测试服务");
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("blocks a user provider before connecting to a private address", async () => {
    const provider = new OpenAITextProvider({
      baseUrl: `https://127.0.0.1:${port}/v1`,
      apiKey: "user-key",
      model: "user-model",
      networkPolicy: "public",
    });

    await expect(
      provider.generateText({ messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("内网");
    expect(requests).toBe(0);
  });

  it("allows a trusted platform provider to use a private endpoint", async () => {
    const provider = new OpenAITextProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "platform-key",
      model: "platform-model",
      networkPolicy: "trusted",
    });

    await expect(
      provider.generateText({ messages: [{ role: "user", content: "test" }] }),
    ).resolves.toBe("OK");
    expect(requests).toBe(1);
  });
});
