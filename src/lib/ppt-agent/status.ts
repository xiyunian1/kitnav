export const PPT_PROCESSING_STATUSES = [
	"PENDING",
	"QUEUED",
	"GENERATING",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
] as const;

export const PPT_RUNNING_STATUSES = [
	"PENDING",
	"GENERATING",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
] as const;

export const PPT_COMPLETED_STATUSES = ["READY", "COMPLETED"] as const;

export const PPT_STATUS_LABELS: Record<string, string> = {
	DRAFT: "草稿",
	PENDING: "等待中",
	QUEUED: "排队中",
	GENERATING: "生成中",
	STRATEGIZING: "规划中",
	ACQUIRING_IMAGES: "采集素材",
	EXECUTING: "生成中",
	EXPORTING: "导出中",
	READY: "已完成",
	COMPLETED: "已完成",
	FAILED: "失败",
};

export const PPT_USER_FAILURE_MESSAGE =
	"生成失败，请稍后重试，或调整资料后重新生成。";
const MAX_PPT_INTERNAL_ERROR_CHARS = 4_000;
const SAFE_PPT_FAILURE_MESSAGES = [
	"资料总文字量超过 8 万字符，请减少文件或精简内容后重试。",
	"文档转换后的文字内容过多，请精简资料后重试。",
	"文档转换后没有可用内容。",
	"上传文档不存在，请重新上传。",
	"不支持的 PPT 文档格式。",
	"链接型 PPT 输入已停用，请上传文件后重新创建任务。",
] as const;

const PROCESSING_STATUS_SET = new Set<string>(PPT_PROCESSING_STATUSES);
const RUNNING_STATUS_SET = new Set<string>(PPT_RUNNING_STATUSES);
const COMPLETED_STATUS_SET = new Set<string>(PPT_COMPLETED_STATUSES);

export function isPptProcessingStatus(
	status: string | null | undefined,
): status is (typeof PPT_PROCESSING_STATUSES)[number] {
	return Boolean(status && PROCESSING_STATUS_SET.has(status));
}

export function isPptRunningStatus(
	status: string | null | undefined,
): status is (typeof PPT_RUNNING_STATUSES)[number] {
	return Boolean(status && RUNNING_STATUS_SET.has(status));
}

export function isPptCompletedStatus(
	status: string | null | undefined,
): status is (typeof PPT_COMPLETED_STATUSES)[number] {
	return Boolean(status && COMPLETED_STATUS_SET.has(status));
}

export function getPptInternalErrorMessage(
	error: unknown,
	fallback = "PPT 生成失败",
) {
	const message = error instanceof Error ? error.message : fallback;
	if (message.length <= MAX_PPT_INTERNAL_ERROR_CHARS) return message;
	return `${message.slice(0, MAX_PPT_INTERNAL_ERROR_CHARS - 3)}...`;
}

export function getPptUserFailureMessage(error: string | null | undefined) {
	return (
		SAFE_PPT_FAILURE_MESSAGES.find((message) => error?.includes(message)) ??
		PPT_USER_FAILURE_MESSAGE
	);
}
