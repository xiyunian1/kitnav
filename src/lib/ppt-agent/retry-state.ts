import { arePptArtifactsExpired } from "./project-public";

export interface RetryablePptProjectState {
	status: string;
	error?: string | null;
	artifactsDeletedAt?: Date | string | null;
	completedAt?: Date | string | null;
	updatedAt?: Date | string | null;
	params?: string | null;
}

export function canRetryPptProject(project: RetryablePptProjectState) {
	return (
		project.status === "FAILED" &&
		!arePptArtifactsExpired(project) &&
		typeof project.params === "string" &&
		project.params.trim().length > 0 &&
		!isCancelledPptFailure(project.error)
	);
}

export function isCancelledPptFailure(error: string | null | undefined) {
	return /用户已停止生成|已主动停止/.test(error || "");
}
