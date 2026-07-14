import crypto from "crypto";
import { readBoundedResponseText } from "@/lib/safe-fetch";

const DEFAULT_GATEWAY = "https://credit.linux.do/epay";
const PAYMENT_RESPONSE_MAX_BYTES = 64 * 1024;
const PAYMENT_REQUEST_TIMEOUT_MS = 15_000;

export type RechargeProvider = "disabled" | "mock" | "linuxdo_credit";

export function getRechargeProvider(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RechargeProvider {
  if (environment.RECHARGE_PROVIDER === "linuxdo_credit") return "linuxdo_credit";
  if (environment.RECHARGE_PROVIDER === "mock" && environment.NODE_ENV !== "production") {
    return "mock";
  }
  return "disabled";
}

export function getLinuxDoCreditConfig() {
  return {
    pid: process.env.LINUX_DO_CREDIT_PID ?? "",
    key: process.env.LINUX_DO_CREDIT_KEY ?? "",
    gateway: (process.env.LINUX_DO_CREDIT_GATEWAY ?? DEFAULT_GATEWAY).replace(/\/+$/, ""),
  };
}

export function resolveLinuxDoPaymentUrl(
  value: string,
  gateway: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  let url: URL;
  try {
    url = new URL(value, gateway);
  } catch {
    throw new Error("Linux.do Credit 返回的支付链接无效");
  }
  const developmentHttp =
    environment.NODE_ENV !== "production" && url.protocol === "http:";
  if ((url.protocol !== "https:" && !developmentHttp) || url.username || url.password) {
    throw new Error("Linux.do Credit 返回的支付链接不安全");
  }
  return url.toString();
}

type SignableParams = Record<string, string | number | boolean | null | undefined>;

function normalizeParams(params: SignableParams, excludeSignType = false) {
  return Object.entries(params)
    .filter(([key, value]) => {
      if (key === "sign") return false;
      if (excludeSignType && key === "sign_type") return false;
      return value !== undefined && value !== null && String(value) !== "";
    })
    .sort(([a], [b]) => a.localeCompare(b, "en"));
}

export function signLinuxDoCreditParams(
  params: SignableParams,
  key: string,
  excludeSignType = false
) {
  const payload =
    normalizeParams(params, excludeSignType)
      .map(([name, value]) => `${name}=${value}`)
      .join("&") + key;

  return crypto.createHash("md5").update(payload).digest("hex").toLowerCase();
}

export function verifyLinuxDoCreditParams(params: SignableParams, key: string) {
  const sign = params.sign ? String(params.sign).toLowerCase() : "";
  if (!/^[a-f0-9]{32}$/.test(sign)) return false;

  const expected = signLinuxDoCreditParams(params, key, true);
  return crypto.timingSafeEqual(
    Buffer.from(expected, "ascii"),
    Buffer.from(sign, "ascii"),
  );
}

export async function createLinuxDoCreditPayment(params: {
  outTradeNo: string;
  name: string;
  money: string;
  notifyUrl: string;
  returnUrl: string;
}) {
  const config = getLinuxDoCreditConfig();
  if (!config.pid || !config.key) {
    throw new Error("Linux.do Credit 商户配置不完整");
  }

  const payload = {
    pid: config.pid,
    type: "epay",
    out_trade_no: params.outTradeNo,
    name: params.name,
    money: params.money,
    notify_url: params.notifyUrl,
    return_url: params.returnUrl,
    sign_type: "MD5",
  };
  const sign = signLinuxDoCreditParams(payload, config.key, true);
  const body = new URLSearchParams({ ...payload, sign });

  const res = await fetch(`${config.gateway}/pay/submit.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(PAYMENT_REQUEST_TIMEOUT_MS),
  });

  const location = res.headers.get("location");
  if (location) {
    await res.body?.cancel();
    return resolveLinuxDoPaymentUrl(location, config.gateway);
  }

  const text = await readBoundedResponseText(
    res,
    PAYMENT_RESPONSE_MAX_BYTES,
    "Linux.do Credit 响应过大",
  );
  if (!res.ok) {
    throw new Error(`Linux.do Credit 请求失败：HTTP ${res.status}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const nested = record.data && typeof record.data === "object" ? record.data : {};
    const url =
      record.url ??
      record.pay_url ??
      (nested as Record<string, unknown>).url ??
      (nested as Record<string, unknown>).pay_url;
    if (typeof url === "string" && url) {
      return resolveLinuxDoPaymentUrl(url, config.gateway);
    }

    const message = record.error_msg ?? record.msg;
    if (typeof message === "string" && message) throw new Error(message);
  }

  throw new Error(text.slice(0, 300) || "Linux.do Credit 创建订单失败");
}
