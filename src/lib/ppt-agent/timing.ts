type TimeValue = Date | string | number | null | undefined;

export interface PptConfirmationTimingState {
	logs?: string | null;
	confirmationWaitStartedAt?: TimeValue;
	confirmationWaitSeconds?: number | null;
}

export interface PptConfirmationTiming {
	confirmationWaitDurationMs: number;
	confirmationWaitStartedAt: Date | null;
}

const WAIT_START_PATTERN = /候选已生成，等待用户确认后继续$/;
const WAIT_END_PATTERN = /用户已确认.+，原任务重新入队$/;
const TIMESTAMPED_LOG_LINE = /^\[([^\]]+)\]\s+(.+)$/;

export function resolvePptConfirmationTiming(
	project: PptConfirmationTimingState,
): PptConfirmationTiming {
	const legacy = parsePptConfirmationTimingFromLogs(project.logs);
	const storedSeconds = Number(project.confirmationWaitSeconds);
	const storedDurationMs = Number.isFinite(storedSeconds)
		? Math.max(0, Math.floor(storedSeconds)) * 1000
		: 0;
	const hasDurableTiming =
		project.confirmationWaitSeconds !== undefined ||
		project.confirmationWaitStartedAt !== undefined;

	return {
		confirmationWaitDurationMs: Math.max(
			storedDurationMs,
			legacy.confirmationWaitDurationMs,
		),
		confirmationWaitStartedAt: hasDurableTiming
			? toDate(project.confirmationWaitStartedAt)
			: legacy.confirmationWaitStartedAt,
	};
}

export function parsePptConfirmationTimingFromLogs(
	logs: string | null | undefined,
): PptConfirmationTiming {
	let confirmationWaitDurationMs = 0;
	let confirmationWaitStartedAt: Date | null = null;

	for (const line of logs?.split(/\r?\n/) ?? []) {
		const match = TIMESTAMPED_LOG_LINE.exec(line.trim());
		if (!match) continue;
		const timestamp = toDate(match[1]);
		if (!timestamp) continue;
		const message = match[2];

		if (WAIT_START_PATTERN.test(message)) {
			confirmationWaitStartedAt ??= timestamp;
			continue;
		}
		if (!WAIT_END_PATTERN.test(message) || !confirmationWaitStartedAt) continue;

		confirmationWaitDurationMs += Math.max(
			0,
			timestamp.getTime() - confirmationWaitStartedAt.getTime(),
		);
		confirmationWaitStartedAt = null;
	}

	return { confirmationWaitDurationMs, confirmationWaitStartedAt };
}

function toDate(value: TimeValue) {
	if (value === null || value === undefined || value === "") return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
}
