import { describe, expect, it } from "vitest";
import {
	getPptInternalErrorMessage,
	getPptUserFailureMessage,
  isPptCompletedStatus,
  isPptProcessingStatus,
  isPptRunningStatus,
} from "./status";

describe("PPT status compatibility", () => {
  it("treats the legacy generating status as active", () => {
    expect(isPptProcessingStatus("GENERATING")).toBe(true);
    expect(isPptRunningStatus("GENERATING")).toBe(true);
  });

  it("treats both legacy and current completion statuses as complete", () => {
    expect(isPptCompletedStatus("READY")).toBe(true);
    expect(isPptCompletedStatus("COMPLETED")).toBe(true);
    expect(isPptCompletedStatus("FAILED")).toBe(false);
  });

	it("bounds internal failure details before persisting them", () => {
		const message = getPptInternalErrorMessage(new Error("x".repeat(10_000)));
		expect(message).toHaveLength(4_000);
		expect(message.endsWith("...")).toBe(true);
		expect(getPptInternalErrorMessage("unknown")).toBe("PPT 生成失败");
	});

	it("only exposes allowlisted actionable failure details", () => {
		expect(
			getPptUserFailureMessage(
				"资料总文字量超过 8 万字符，请减少文件或精简内容后重试。",
			),
		).toContain("超过 8 万字符");
		expect(getPptUserFailureMessage("provider key abc-secret failed")).toBe(
			"生成失败，请稍后重试，或调整资料后重新生成。",
		);
	});
});
