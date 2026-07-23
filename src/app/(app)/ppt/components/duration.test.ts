import { describe, expect, it } from "vitest";
import { formatProjectDurationLabel } from "./duration";

describe("PPT project duration", () => {
	it("shows only the accumulated worker lease duration", () => {
		expect(
			formatProjectDurationLabel({
				activeDurationMs: 2_197_000,
				running: false,
				now: null,
			}),
		).toBe("用时 36 分钟 37 秒");
	});

	it("adds only the currently open worker lease interval", () => {
		const input = {
			activeDurationMs: 153_000,
			activeStartedAt: "2026-07-21T01:05:00.000Z",
			running: true,
		};

		expect(
			formatProjectDurationLabel({
				...input,
				now: new Date("2026-07-21T01:07:00.000Z").getTime(),
			}),
		).toBe("已用时 4 分钟 33 秒");
	});

	it("does not count queue or confirmation waiting without an active lease", () => {
		expect(
			formatProjectDurationLabel({
				activeDurationMs: 153_000,
				activeStartedAt: null,
				running: true,
				now: new Date("2026-07-21T02:07:00.000Z").getTime(),
			}),
		).toBe("已用时 2 分钟 33 秒");
	});
});
