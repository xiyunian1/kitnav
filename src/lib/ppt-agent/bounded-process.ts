import {
	spawn,
	type ChildProcess,
	type SpawnOptionsWithoutStdio,
} from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const FORCE_KILL_DELAY_MS = 2_000;

export interface BoundedProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
}

export interface BoundedProcessOptions {
	timeoutMs: number;
	maxOutputBytes?: number;
	signal?: AbortSignal;
	spawnOptions?: SpawnOptionsWithoutStdio;
	timeoutError?: () => Error;
	abortError?: (reason: unknown) => Error;
	outputLimitError?: (maxOutputBytes: number) => Error;
	spawnError?: (error: Error) => Error;
}

function sendSignal(childProcess: ChildProcess, signal: NodeJS.Signals) {
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
	if (process.platform !== "win32" && childProcess.pid) {
		try {
			process.kill(-childProcess.pid, signal);
			return;
		} catch {
			// Fall back to signaling the direct child if its process group is gone.
		}
	}
	try {
		childProcess.kill(signal);
	} catch {
		// The child may have exited between the state check and the signal.
	}
}

export function terminateProcessTree(childProcess: ChildProcess) {
	sendSignal(childProcess, "SIGTERM");
	const forceKill = setTimeout(
		() => sendSignal(childProcess, "SIGKILL"),
		FORCE_KILL_DELAY_MS,
	);
	forceKill.unref();
	childProcess.once("close", () => clearTimeout(forceKill));
}

export function runBoundedProcess(
	command: string,
	args: string[],
	options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new Error("Process timeout must be a positive integer");
	}
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
		throw new Error("Process output limit must be a positive integer");
	}
	if (options.signal?.aborted) {
		return Promise.reject(
			options.abortError?.(options.signal.reason) ??
				(options.signal.reason instanceof Error
					? options.signal.reason
					: new Error("Process was cancelled")),
		);
	}

	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			...options.spawnOptions,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;

		const cleanup = () => {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		};
		const finish = (error?: Error, result?: BoundedProcessResult) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error) reject(error);
			else resolvePromise(result!);
		};
		const stop = (error: Error) => {
			terminateProcessTree(child);
			child.stdout.destroy();
			child.stderr.destroy();
			finish(error);
		};
		const abort = () => {
			stop(
				options.abortError?.(options.signal?.reason) ??
					(options.signal?.reason instanceof Error
						? options.signal.reason
						: new Error("Process was cancelled")),
			);
		};
		const append = (target: Buffer[], chunk: Buffer | string) => {
			if (settled) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			outputBytes += buffer.length;
			if (outputBytes > maxOutputBytes) {
				stop(
					options.outputLimitError?.(maxOutputBytes) ??
						new Error(`Process output exceeded ${maxOutputBytes} bytes`),
				);
				return;
			}
			target.push(buffer);
		};

		const timer = setTimeout(() => {
			stop(
				options.timeoutError?.() ??
					new Error(`Process timed out after ${options.timeoutMs}ms`),
			);
		}, options.timeoutMs);
		child.stdout.on("data", (chunk) => append(stdout, chunk));
		child.stderr.on("data", (chunk) => append(stderr, chunk));
		child.once("error", (error) => {
			finish(options.spawnError?.(error) ?? error);
		});
		child.once("close", (exitCode, signal) => {
			finish(undefined, {
				stdout: Buffer.concat(stdout).toString("utf-8"),
				stderr: Buffer.concat(stderr).toString("utf-8"),
				exitCode,
				signal,
			});
		});
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
	});
}
