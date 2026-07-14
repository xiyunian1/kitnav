import { describe, expect, it } from "vitest";
import { runBoundedProcess } from "./bounded-process";

describe("runBoundedProcess", () => {
	it("captures bounded stdout and stderr", async () => {
		const result = await runBoundedProcess(
			process.execPath,
			[
				"-e",
				"process.stdout.write('out'); process.stderr.write('err')",
			],
			{ timeoutMs: 5_000 },
		);

		expect(result).toMatchObject({
			stdout: "out",
			stderr: "err",
			exitCode: 0,
			signal: null,
		});
	});

	it("returns non-zero exits to the caller", async () => {
		const result = await runBoundedProcess(
			process.execPath,
			["-e", "process.stderr.write('failed'); process.exit(7)"],
			{ timeoutMs: 5_000 },
		);

		expect(result).toMatchObject({ stderr: "failed", exitCode: 7 });
	});

	it("terminates a process that exceeds its output limit", async () => {
		await expect(
			runBoundedProcess(
				process.execPath,
				["-e", "process.stdout.write('x'.repeat(4096))"],
				{ timeoutMs: 5_000, maxOutputBytes: 1024 },
			),
		).rejects.toThrow("exceeded 1024 bytes");
	});

	it("terminates timed out and aborted processes", async () => {
		await expect(
			runBoundedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
				timeoutMs: 20,
			}),
		).rejects.toThrow("timed out");

		const controller = new AbortController();
		const running = runBoundedProcess(
			process.execPath,
			["-e", "setInterval(() => {}, 1000)"],
			{ timeoutMs: 5_000, signal: controller.signal },
		);
		controller.abort(new Error("cancelled by test"));
		await expect(running).rejects.toThrow("cancelled by test");
	});
});
