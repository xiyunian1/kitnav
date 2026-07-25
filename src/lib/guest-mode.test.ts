import { describe, expect, it } from "vitest";
import {
  GUEST_USER_EMAIL,
  isGuestModeEnabled,
  isGuestRole,
  isGuestUserEmail,
  isSafeHttpMethod,
  shouldBlockGuestRequest,
  shouldEvictGuestSession,
} from "./guest-mode";

describe("guest mode", () => {
  it("only enables guest login for an explicit true value", () => {
    expect(isGuestModeEnabled({ GUEST_MODE_ENABLED: "true" })).toBe(true);
    expect(isGuestModeEnabled({ GUEST_MODE_ENABLED: "TRUE" })).toBe(false);
    expect(isGuestModeEnabled({ GUEST_MODE_ENABLED: "1" })).toBe(false);
    expect(isGuestModeEnabled({ GUEST_MODE_ENABLED: undefined })).toBe(false);
  });

  it("recognizes only the dedicated guest role and email", () => {
    expect(isGuestRole("GUEST")).toBe(true);
    expect(isGuestRole("USER")).toBe(false);
    expect(isGuestUserEmail(`  ${GUEST_USER_EMAIL.toUpperCase()}  `)).toBe(true);
    expect(isGuestUserEmail("user@example.com")).toBe(false);
  });

  it("treats only read-only HTTP methods as safe", () => {
    expect(isSafeHttpMethod("GET")).toBe(true);
    expect(isSafeHttpMethod("head")).toBe(true);
    expect(isSafeHttpMethod("OPTIONS")).toBe(true);
    expect(isSafeHttpMethod("POST")).toBe(false);
    expect(isSafeHttpMethod("DELETE")).toBe(false);
  });

  it("blocks guest writes while preserving Auth.js login and logout", () => {
    expect(
      shouldBlockGuestRequest({
        role: "GUEST",
        method: "POST",
        pathname: "/api/image/turns",
      }),
    ).toBe(true);
    expect(
      shouldBlockGuestRequest({
        role: "GUEST",
        method: "POST",
        pathname: "/profile",
      }),
    ).toBe(true);
    expect(
      shouldBlockGuestRequest({
        role: "GUEST",
        method: "POST",
        pathname: "/api/auth/signout",
      }),
    ).toBe(false);
    expect(
      shouldBlockGuestRequest({
        role: "GUEST",
        method: "GET",
        pathname: "/api/ppt/projects",
      }),
    ).toBe(false);
    expect(
      shouldBlockGuestRequest({
        role: "USER",
        method: "POST",
        pathname: "/api/image/turns",
      }),
    ).toBe(false);
  });

  it("evicts guest sessions only after the entrance is switched off", () => {
    const off = { GUEST_MODE_ENABLED: "false" };
    const on = { GUEST_MODE_ENABLED: "true" };
    expect(
      shouldEvictGuestSession({ role: "GUEST", pathname: "/image" }, off),
    ).toBe(true);
    expect(
      shouldEvictGuestSession({ role: "GUEST", pathname: "/api/ppt/projects" }, off),
    ).toBe(true);
    // Logout must keep working so the stale cookie can be cleared.
    expect(
      shouldEvictGuestSession({ role: "GUEST", pathname: "/api/auth/signout" }, off),
    ).toBe(false);
    expect(
      shouldEvictGuestSession({ role: "GUEST", pathname: "/image" }, on),
    ).toBe(false);
    expect(
      shouldEvictGuestSession({ role: "USER", pathname: "/image" }, off),
    ).toBe(false);
  });
});
