import { describe, expect, it } from "vitest";
import { resolveAdminSeedCredentials } from "../../scripts/admin-credentials";

describe("resolveAdminSeedCredentials", () => {
  it("disables admin seeding when both credentials are absent", () => {
    expect(resolveAdminSeedCredentials({})).toBeNull();
  });

  it("requires email and password together", () => {
    expect(() =>
      resolveAdminSeedCredentials({ ADMIN_EMAIL: "admin@kitnav.test" }),
    ).toThrow("configured together");
    expect(() =>
      resolveAdminSeedCredentials({ ADMIN_PASSWORD: "a-secure-password" }),
    ).toThrow("configured together");
  });

  it("rejects placeholder credentials", () => {
    expect(() =>
      resolveAdminSeedCredentials({
        ADMIN_EMAIL: "admin@example.com",
        ADMIN_PASSWORD: "a-secure-password",
      }),
    ).toThrow("non-placeholder email");
    expect(() =>
      resolveAdminSeedCredentials({
        ADMIN_EMAIL: "admin@kitnav.test",
        ADMIN_PASSWORD: "replace-with-a-password",
      }),
    ).toThrow("must not be a placeholder");
  });

  it("normalizes valid credentials", () => {
    expect(
      resolveAdminSeedCredentials({
        ADMIN_EMAIL: "  Admin@Kitnav.test ",
        ADMIN_PASSWORD: "strong-local-password",
        ADMIN_NAME: "  Site Admin ",
      }),
    ).toEqual({
      email: "admin@kitnav.test",
      password: "strong-local-password",
      name: "Site Admin",
    });
  });
});
