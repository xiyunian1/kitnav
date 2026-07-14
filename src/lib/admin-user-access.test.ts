import { describe, expect, it } from "vitest";
import { removesActiveAdminAccess } from "./admin-user-access";

describe("removesActiveAdminAccess", () => {
  it("detects demoting or banning an active administrator", () => {
    const activeAdmin = { role: "ADMIN", status: "ACTIVE" } as const;

    expect(removesActiveAdminAccess(activeAdmin, { role: "USER" })).toBe(true);
    expect(removesActiveAdminAccess(activeAdmin, { status: "BANNED" })).toBe(
      true,
    );
  });

  it("allows changes that preserve active administrator access", () => {
    expect(
      removesActiveAdminAccess(
        { role: "ADMIN", status: "ACTIVE" },
        { role: "ADMIN" },
      ),
    ).toBe(false);
    expect(
      removesActiveAdminAccess(
        { role: "ADMIN", status: "BANNED" },
        { role: "USER" },
      ),
    ).toBe(false);
    expect(
      removesActiveAdminAccess(
        { role: "USER", status: "ACTIVE" },
        { status: "BANNED" },
      ),
    ).toBe(false);
  });
});
