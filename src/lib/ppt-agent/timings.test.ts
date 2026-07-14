import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPptAgentTimeoutMs, getStaleActiveProjectMs } from "./timings";

/**
 * 过期项目阈值回归测试：PPT 生成固定使用 pi agent，默认阈值必须覆盖 agent 单轮超时。
 */

describe("getStaleActiveProjectMs", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		delete process.env.PPT_STALE_ACTIVE_PROJECT_MS;
		delete process.env.PPT_AGENT_TIMEOUT_MS;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("默认 = agent 超时(2h) + 10 分钟缓冲", () => {
		expect(getStaleActiveProjectMs()).toBe(2 * 60 * 60 * 1000 + 10 * 60 * 1000);
	});

	it("自定义 agent 超时应正确累加缓冲", () => {
		process.env.PPT_AGENT_TIMEOUT_MS = "1800000"; // 30 分钟
		expect(getPptAgentTimeoutMs()).toBe(1800000);
		expect(getStaleActiveProjectMs()).toBe(1800000 + 10 * 60 * 1000);
	});

	it.each(["not-a-number", "1.5", "0", "-1", "2147483648"])(
		"无效 agent 超时 %s 回退到默认值",
		(value) => {
			process.env.PPT_AGENT_TIMEOUT_MS = value;
			expect(getPptAgentTimeoutMs()).toBe(2 * 60 * 60 * 1000);
			expect(getStaleActiveProjectMs()).toBe(
				2 * 60 * 60 * 1000 + 10 * 60 * 1000,
			);
		},
	);

	it("显式 PPT_STALE_ACTIVE_PROJECT_MS 始终优先", () => {
		process.env.PPT_STALE_ACTIVE_PROJECT_MS = "90000";
		expect(getStaleActiveProjectMs()).toBe(90000);
	});


	it.each(["not-a-number", "1.5", "0", "-1", "2148083648"])(
		"无效的显式值 %s 被忽略",
		(value) => {
			process.env.PPT_STALE_ACTIVE_PROJECT_MS = value;
			expect(getStaleActiveProjectMs()).toBe(
				2 * 60 * 60 * 1000 + 10 * 60 * 1000,
			);
		},
	);
});
