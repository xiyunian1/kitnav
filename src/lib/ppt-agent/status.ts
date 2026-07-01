export const PPT_PROCESSING_STATUSES = [
	"PENDING",
	"QUEUED",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
] as const;

export const PPT_RUNNING_STATUSES = [
	"PENDING",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
] as const;

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

const PROCESSING_STATUS_SET = new Set<string>(PPT_PROCESSING_STATUSES);
const RUNNING_STATUS_SET = new Set<string>(PPT_RUNNING_STATUSES);

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
