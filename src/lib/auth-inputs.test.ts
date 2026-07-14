import { describe, expect, it } from "vitest";
import { fitsBcryptPasswordLimit } from "./auth-inputs";

describe("fitsBcryptPasswordLimit", () => {
  it("accepts passwords up to bcrypt's 72-byte boundary", () => {
    expect(fitsBcryptPasswordLimit("a".repeat(72))).toBe(true);
    expect(fitsBcryptPasswordLimit("中".repeat(24))).toBe(true);
  });

  it("rejects passwords that bcrypt would silently truncate", () => {
    expect(fitsBcryptPasswordLimit("a".repeat(73))).toBe(false);
    expect(fitsBcryptPasswordLimit("中".repeat(25))).toBe(false);
  });
});
