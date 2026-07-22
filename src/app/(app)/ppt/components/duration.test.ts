import { describe, expect, it } from "vitest";
import { formatProjectDurationLabel } from "./duration";

describe("PPT project duration", () => {
	it("subtracts completed user confirmation waits", () => {
		expect(
			formatProjectDurationLabel({
				startedAt: "2026-07-21T01:00:00.000Z",
				completedAt: "2026-07-21T01:41:11.000Z",
				pausedDurationMs: 274_000,
				running: false,
				now: null,
			}),
		).toBe("用时 36 分钟 37 秒");
	});

	it("freezes active generation time while confirmation is pending", () => {
		const input = {
			startedAt: "2026-07-21T01:00:00.000Z",
			pausedAt: "2026-07-21T01:02:33.000Z",
			pausedDurationMs: 0,
			running: true,
		};

		expect(
			formatProjectDurationLabel({
				...input,
				now: new Date("2026-07-21T01:07:00.000Z").getTime(),
			}),
		).toBe("已用时 2 分钟 33 秒");
		expect(
			formatProjectDurationLabel({
				...input,
				now: new Date("2026-07-21T02:07:00.000Z").getTime(),
			}),
		).toBe("已用时 2 分钟 33 秒");
	});
});
