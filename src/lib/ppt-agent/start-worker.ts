import { logger } from "@/lib/logger";

export function wakePptWorker(): void {
	void import("./worker")
		.then(({ startPptWorker }) => {
			startPptWorker();
		})
		.catch((error) => {
			logger.error("ppt-worker", "启动后台 worker 失败", { error });
		});
}
