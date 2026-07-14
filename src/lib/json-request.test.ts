import { describe, expect, it } from "vitest";
import {
  JsonRequestBodyError,
  jsonRequestErrorDetails,
  readLimitedJsonBody,
} from "./json-request";

describe("limited JSON request bodies", () => {
  it("parses valid JSON including multibyte text", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ title: "中文标题" }),
    });

    await expect(readLimitedJsonBody(request, 1024)).resolves.toEqual({
      title: "中文标题",
    });
  });

  it("rejects an oversized declared content length before reading", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "{}",
    });

    await expect(readLimitedJsonBody(request, 1024)).rejects.toMatchObject({
      name: "JsonRequestBodyError",
      status: 413,
    });
    await expect(request.text()).resolves.toBe("{}");
  });

  it("enforces the actual streamed byte count without content length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "x".repeat(2048) }),
    });

    await expect(readLimitedJsonBody(request, 1024)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects empty and malformed JSON", async () => {
    await expect(
      readLimitedJsonBody(
        new Request("https://example.test", { method: "POST" }),
        1024,
      ),
    ).rejects.toBeInstanceOf(JsonRequestBodyError);
    await expect(
      readLimitedJsonBody(
        new Request("https://example.test", {
          method: "POST",
          body: "{not-json}",
        }),
        1024,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("preserves body errors and normalizes unexpected parser failures", () => {
    expect(
      jsonRequestErrorDetails(new JsonRequestBodyError("请求内容过大", 413)),
    ).toEqual({ message: "请求内容过大", status: 413 });
    expect(jsonRequestErrorDetails(new Error("internal"), "参数错误")).toEqual(
      { message: "参数错误", status: 400 },
    );
  });
});
