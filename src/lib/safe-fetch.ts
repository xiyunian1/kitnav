import { promises as dns } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const blockedAddresses = createBlockedAddressLists();
let publicResourceDispatcher: Agent | undefined;

export class PublicUrlSafetyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PublicUrlSafetyError";
  }
}

export interface PublicResource {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
}

interface FetchPublicResourceOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
}

interface FetchPublicApiOptions {
  fetchImpl?: typeof fetch;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PublicUrlSafetyError("URL 格式不正确。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicUrlSafetyError("URL 只支持 http 或 https。");
  }
  if (url.username || url.password) {
    throw new PublicUrlSafetyError("URL 不能包含用户名或密码。");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new PublicUrlSafetyError("不支持访问本机地址。");
  }
  const addresses = await resolveAllAddresses(host);
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new PublicUrlSafetyError("不支持访问内网或保留地址。");
  }
  return url;
}

export async function assertSafePublicApiUrl(rawUrl: string): Promise<URL> {
  const url = await assertSafePublicUrl(rawUrl);
  if (url.protocol !== "https:") {
    throw new PublicUrlSafetyError("用户 API Base URL 必须使用公网 HTTPS 地址。");
  }
  return url;
}

export async function fetchPublicApi(
  rawUrl: string,
  init: RequestInit = {},
  options: FetchPublicApiOptions = {},
): Promise<Response> {
  const safeUrl = await assertSafePublicApiUrl(rawUrl);
  const response = await performPublicFetch(
    safeUrl,
    { ...init, redirect: "manual" },
    options.fetchImpl,
  );
  if (REDIRECT_STATUSES.has(response.status)) {
    await response.body?.cancel();
    throw new PublicUrlSafetyError("用户 API 不允许重定向请求。");
  }
  return response;
}

export async function fetchPublicResource(
  rawUrl: string,
  options: FetchPublicResourceOptions,
): Promise<PublicResource> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const safeUrl = await assertSafePublicUrl(current);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const requestInit: RequestInit = {
      headers: options.headers,
      redirect: "manual",
      signal,
    };
    const response = await performPublicFetch(
      safeUrl,
      requestInit,
      options.fetchImpl,
    );

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("资源下载重定向无效。");
      if (redirectCount === maxRedirects) {
        throw new Error("资源下载重定向次数过多。");
      }
      current = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`资源下载失败：HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      await response.body?.cancel();
      throw new Error("资源文件过大。");
    }

    return {
      buffer: await readResponseBody(
        response,
        options.maxBytes,
        "资源文件过大。",
      ),
      contentType: response.headers.get("content-type"),
      finalUrl: safeUrl.toString(),
    };
  }

  throw new Error("资源下载重定向次数过多。");
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  tooLargeMessage = "上游响应过大。",
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("响应大小上限必须是正整数。");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(tooLargeMessage);
  }
  return (await readResponseBody(response, maxBytes, tooLargeMessage)).toString(
    "utf8",
  );
}

export async function readBoundedJsonResponse<T = unknown>(
  response: Response,
  maxBytes: number,
  tooLargeMessage = "上游响应过大。",
): Promise<T> {
  const text = await readBoundedResponseText(
    response,
    maxBytes,
    tooLargeMessage,
  );
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("上游返回格式无法解析");
  }
}

async function readResponseBody(
  response: Response,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(tooLargeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function resolveAllAddresses(host: string): Promise<string[]> {
  if (isIP(host)) return [host];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (records.length === 0) {
      throw new PublicUrlSafetyError("无法解析资源域名。");
    }
    return records.map((record) => record.address);
  } catch (error) {
    if (error instanceof PublicUrlSafetyError) throw error;
    throw new PublicUrlSafetyError("无法解析资源域名。", { cause: error });
  }
}

function isPrivateOrReservedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedAddresses.ipv4.check(address, "ipv4");
  if (family === 6) return blockedAddresses.ipv6.check(address, "ipv6");
  return true;
}

const lookupPublicAddress: LookupFunction = (hostname, options, callback) => {
  void dns
    .lookup(hostname, {
      all: true,
      family: options.family,
      hints: options.hints,
      verbatim: true,
    })
    .then((records) => {
      if (records.length === 0 || records.some((record) => isPrivateOrReservedAddress(record.address))) {
        throw new PublicUrlSafetyError("不支持访问内网或保留地址。");
      }
      if (options.all) {
        callback(null, records);
        return;
      }
      const selected = records[0];
      callback(null, selected.address, selected.family);
    })
    .catch((error: unknown) => {
      callback(error instanceof Error ? error : new Error(String(error)), "", 0);
    });
};

async function performPublicFetch(
  url: URL,
  init: RequestInit,
  fetchImpl?: typeof fetch,
) {
  if (fetchImpl) return fetchImpl(url, init);
  try {
    return (await undiciFetch(url, {
      ...init,
      dispatcher: getPublicResourceDispatcher(),
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
  } catch (error) {
    const safetyError = findPublicUrlSafetyError(error);
    if (safetyError) {
      throw new PublicUrlSafetyError(safetyError.message, { cause: error });
    }
    throw error;
  }
}

function findPublicUrlSafetyError(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof PublicUrlSafetyError) return current;
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return null;
}

function getPublicResourceDispatcher() {
  publicResourceDispatcher ??= new Agent({
    connect: { lookup: lookupPublicAddress },
  });
  return publicResourceDispatcher;
}

function createBlockedAddressLists() {
  const ipv4 = new BlockList();
  const ipv6 = new BlockList();
  for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 3],
  ] as const) {
    ipv4.addSubnet(network, prefix, "ipv4");
  }
  for (const [network, prefix] of [
    ["::", 96],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const) {
    ipv6.addSubnet(network, prefix, "ipv6");
  }
  return { ipv4, ipv6 };
}
