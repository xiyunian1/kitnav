import { describe, expect, it } from "vitest";
import {
	PptAgentLogLineBuffer,
	PptPendingLogWrites,
} from "./agent-log-lines";

describe("PPT agent log line buffering", () => {
	it("drops an oversized JSON line instead of exposing its tail as plain text", () => {
		const buffer = new PptAgentLogLineBuffer(20);
		expect(buffer.push('{"type":"message","')).toEqual({
			lines: [],
			oversized: false,
		});
		expect(buffer.push(`content":"${"secret".repeat(20)}`)).toEqual({
			lines: [],
			oversized: true,
		});
		expect(
			buffer.push('"}\n{"type":"agent_end"}\n'),
		).toEqual({
			lines: ['{"type":"agent_end"}'],
			oversized: false,
		});
		expect(buffer.flush()).toEqual([]);
	});

	it("preserves complete bounded lines across chunk boundaries", () => {
		const buffer = new PptAgentLogLineBuffer(100);
		expect(buffer.push("first")).toEqual({ lines: [], oversized: false });
		expect(buffer.push("\nsecond\nthird")).toEqual({
			lines: ["first", "second"],
			oversized: false,
		});
		expect(buffer.flush()).toEqual(["third"]);
	});

	it("waits for successful and failed project log writes before returning", async () => {
		const writes = new PptPendingLogWrites();
		let resolveWrite: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			resolveWrite = resolve;
		});
		writes.add(pending);
		writes.add(Promise.reject(new Error("lease lost")));

		let drained = false;
		const drain = writes.drain().then(() => {
			drained = true;
		});
		await Promise.resolve();
		expect(drained).toBe(false);

		resolveWrite?.();
		await drain;
		expect(drained).toBe(true);
	});
});
