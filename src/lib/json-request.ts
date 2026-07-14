export const JSON_BODY_LIMITS = {
  small: 16 * 1024,
  standard: 64 * 1024,
  pptGeneration: 256 * 1024,
  generatedImage: 12 * 1024 * 1024,
} as const;

export class JsonRequestBodyError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "JsonRequestBodyError";
  }
}

export async function readLimitedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("JSON 请求体上限必须为正整数");
  }

  const declaredLength = parseContentLength(
    request.headers.get("content-length"),
  );
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw bodyTooLarge();
  }
  if (!request.body) throw malformedBody();

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("JSON request body exceeded its limit");
        throw bodyTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof JsonRequestBodyError) throw error;
    throw malformedBody();
  } finally {
    reader.releaseLock();
  }

  if (!text.trim()) throw malformedBody();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw malformedBody();
  }
}

export function jsonRequestErrorDetails(
  error: unknown,
  fallbackMessage = "请求格式错误",
) {
  return error instanceof JsonRequestBodyError
    ? { message: error.message, status: error.status }
    : { message: fallbackMessage, status: 400 as const };
}

function parseContentLength(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function malformedBody() {
  return new JsonRequestBodyError("请求格式错误", 400);
}

function bodyTooLarge() {
  return new JsonRequestBodyError("请求内容过大", 413);
}
