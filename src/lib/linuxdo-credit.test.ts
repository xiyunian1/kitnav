import { describe, expect, it } from "vitest";
import {
  getRechargeProvider,
  resolveLinuxDoPaymentUrl,
  signLinuxDoCreditParams,
  verifyLinuxDoCreditParams,
} from "./linuxdo-credit";

describe("getRechargeProvider", () => {
  it("does not enable mock recharge in production", () => {
    expect(
      getRechargeProvider({ NODE_ENV: "production", RECHARGE_PROVIDER: "mock" }),
    ).toBe("disabled");
    expect(getRechargeProvider({ NODE_ENV: "production" })).toBe("disabled");
  });

  it("allows explicit mock recharge outside production", () => {
    expect(
      getRechargeProvider({ NODE_ENV: "development", RECHARGE_PROVIDER: "mock" }),
    ).toBe("mock");
    expect(
      getRechargeProvider({ NODE_ENV: "production", RECHARGE_PROVIDER: "linuxdo_credit" }),
    ).toBe("linuxdo_credit");
  });
});

describe("resolveLinuxDoPaymentUrl", () => {
  it("resolves secure relative payment URLs", () => {
    expect(
      resolveLinuxDoPaymentUrl(
        "/checkout/123",
        "https://credit.example/epay",
        { NODE_ENV: "production" },
      ),
    ).toBe("https://credit.example/checkout/123");
  });

  it("rejects executable and insecure production URLs", () => {
    expect(() =>
      resolveLinuxDoPaymentUrl("javascript:alert(1)", "https://credit.example", {
        NODE_ENV: "production",
      }),
    ).toThrow("支付链接不安全");
    expect(() =>
      resolveLinuxDoPaymentUrl("http://credit.example/pay", "https://credit.example", {
        NODE_ENV: "production",
      }),
    ).toThrow("支付链接不安全");
  });
});

describe("verifyLinuxDoCreditParams", () => {
  const key = "test-secret";
  const params = {
    pid: "1001",
    out_trade_no: "order-123",
    money: "9.90",
    sign_type: "MD5",
  };

  it("accepts a valid hexadecimal signature case-insensitively", () => {
    const sign = signLinuxDoCreditParams(params, key, true).toUpperCase();
    expect(verifyLinuxDoCreditParams({ ...params, sign }, key)).toBe(true);
  });

  it("rejects tampered and malformed signatures", () => {
    const sign = signLinuxDoCreditParams(params, key, true);
    const tampered = `${sign.slice(0, -1)}${sign.endsWith("0") ? "1" : "0"}`;

    expect(verifyLinuxDoCreditParams({ ...params, sign: tampered }, key)).toBe(false);
    expect(verifyLinuxDoCreditParams({ ...params, sign: "not-a-signature" }, key)).toBe(false);
    expect(verifyLinuxDoCreditParams({ ...params, sign: `${sign}00` }, key)).toBe(false);
  });
});
