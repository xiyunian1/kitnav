type TimeValue = Date | string | number | null | undefined;

export function formatProjectDurationLabel({
	startedAt,
	completedAt,
	updatedAt,
	running,
	now,
}: {
	startedAt: TimeValue;
	completedAt?: TimeValue;
	updatedAt?: TimeValue;
	running: boolean;
	now: number | null | undefined;
}) {
	const startMs = toTimeMs(startedAt);
	if (startMs === null) return "";

	const endMs = running
		? toTimeMs(now)
		: (toTimeMs(completedAt) ?? toTimeMs(updatedAt));
	if (endMs === null) return "";
	if (endMs < startMs) return "";

	const duration = formatDurationMs(endMs - startMs);
	return `${running ? "已用时" : "用时"} ${duration}`;
}

function toTimeMs(value: TimeValue) {
	if (value === null || value === undefined || value === "") return null;
	const time = typeof value === "number" ? value : new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
}

function formatDurationMs(value: number) {
	const totalSeconds = Math.max(0, Math.floor(value / 1000));
	const days = Math.floor(totalSeconds / 86_400);
	const hours = Math.floor((totalSeconds % 86_400) / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (days > 0) return `${days} 天 ${hours} 小时`;
	if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
	if (minutes > 0) return `${minutes} 分钟 ${seconds} 秒`;
	return `${seconds} 秒`;
}
