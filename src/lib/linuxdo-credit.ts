import crypto from "crypto";

const DEFAULT_GATEWAY = "https://credit.linux.do/epay";

export type RechargeProvider = "mock" | "linuxdo_credit";

export function getRechargeProvider(): RechargeProvider {
  return process.env.RECHARGE_PROVIDER === "linuxdo_credit" ? "linuxdo_credit" : "mock";
}

export function getLinuxDoCreditConfig() {
  return {
    pid: process.env.LINUX_DO_CREDIT_PID ?? "",
    key: process.env.LINUX_DO_CREDIT_KEY ?? "",
    gateway: (process.env.LINUX_DO_CREDIT_GATEWAY ?? DEFAULT_GATEWAY).replace(/\/+$/, ""),
  };
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
  if (!sign) return false;
  return signLinuxDoCreditParams(params, key, true) === sign;
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
  });

  const location = res.headers.get("location");
  if (location) return new URL(location, config.gateway).toString();

  const text = await res.text();
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
    if (typeof url === "string" && url) return new URL(url, config.gateway).toString();

    const message = record.error_msg ?? record.msg;
    if (typeof message === "string" && message) throw new Error(message);
  }

  throw new Error(text.slice(0, 300) || "Linux.do Credit 创建订单失败");
}
