import { describe, expect, it } from "vitest";
import { formatChinaDate, formatChinaDateTime } from "./date-format";

describe("China time formatting", () => {
  it("formats UTC timestamps in Asia/Shanghai", () => {
    expect(
      formatChinaDateTime(new Date("2026-07-27T10:50:15.000Z")),
    ).toBe("2026/7/27 18:50:15");
  });

  it("uses the China calendar date across the UTC day boundary", () => {
    expect(formatChinaDate(new Date("2026-07-27T16:30:00.000Z"))).toBe(
      "2026/7/28",
    );
  });

  it("renders missing timestamps consistently", () => {
    expect(formatChinaDateTime(null)).toBe("-");
    expect(formatChinaDate(undefined)).toBe("-");
  });
});
