import { prisma } from "@/lib/db";
import {
	generatePPT,
	type EventEmitter,
	type GenerationParams,
} from "./generator";
import {
	claimNextPptProject,
	heartbeatPptProject,
	requeuePptProject,
	sweepStalePptProjects,
} from "./queue";
import {
	abortAllPptGenerationsForShutdown,
	isPptGenerationCancelled,
	isPptWorkerShutdown,
	PptWorkerShutdownError,
	registerPptGeneration,
} from "./cancellation";
import {
	refundPptProjectCredits,
	sweepPendingPptRefunds,
} from "./refund";
import { logger, onError } from "@/lib/logger";
import { boundedIntegerEnv } from "@/lib/runtime-config";
import {
	appendProjectLog,
	isPptLeaseLostError,
	PptLeaseLostError,
} from "./project-log";
import { getPptConcurrencyLimit } from "./semaphore";
import {
	getPptInternalErrorMessage,
	PPT_PROCESSING_STATUSES,
} from "./status";
import { isPptPlanningConfirmationRequiredError } from "./planning-confirmation";
import {
	PPT_STORAGE_DEFAULT_SWEEP_INTERVAL_MS,
	PPT_STORAGE_MIN_SWEEP_INTERVAL_MS,
	sweepPptStorage,
} from "./storage-retention";

/**
 * 进程内 PPT 生成 worker 单例。
 *
 * 生成流程从「请求内 SSE 同步执行」改为「后台 worker 异步消费」：
 *   - generate 路由只创建项目（QUEUED）+ 预扣积分 + 入队，立即返回 projectId；
 *   - 本 worker 在 next start 进程内轮询 Postgres 队列，抢占 QUEUED 项目并执行
 *     generatePPT，进度/日志写回 DB，前端轮询 GET /api/ppt/projects/[id] 获取。
 *
 * 跨副本安全：claimNextPptProject 用 SELECT ... FOR UPDATE SKIP LOCKED，每个 worker
 * 抢到的项目互不相同，不会重复处理或重复扣费。单副本内的并发由 generatePPT 内的
 * pptSemaphore 控制（可由 PPT_AGENT_MAX_CONCURRENT 调整）。
 *
 * 启动：scripts/start-ppt-worker.ts 在独立进程中调用 startPptWorker()，保证 Web
 * 服务重启不影响任务消费，worker 重启后会自动恢复 QUEUED 项目。
 */

const POLL_INTERVAL_MS = boundedIntegerEnv("PPT_WORKER_POLL_MS", 2_000, {
	min: 100,
});
const SWEEP_INTERVAL_MS = boundedIntegerEnv("PPT_WORKER_SWEEP_MS", 30_000, {
	min: 1_000,
});
const PROJECT_HEARTBEAT_MS = boundedIntegerEnv(
	"PPT_WORKER_HEARTBEAT_MS",
	10_000,
	{ min: 1_000 },
);

let started = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let queueSweepInFlight: Promise<void> | null = null;
let storageSweepTimer: ReturnType<typeof setInterval> | null = null;
let storageSweepInFlight: Promise<void> | null = null;
const activeJobs = new Set<Promise<void>>();
const activeProjects = new Map<string, string>();
const pollLoops = new Set<Promise<void>>();

export function startPptWorker(): void {
	if (started) return;
	started = true;

	// 每个消费循环一次只处理一个项目；多个循环共享 generatePPT 的信号量上限。
	for (let workerIndex = 0; workerIndex < getPptConcurrencyLimit(); workerIndex += 1) {
		const loop = pollLoop(workerIndex);
		pollLoops.add(loop);
		void loop.finally(() => pollLoops.delete(loop));
	}

	// 周期性孤儿扫描：释放心跳停止的卡死项目（退款 + 标记失败），自愈崩溃场景。
	void runQueueSweep();
	sweepTimer = setInterval(runQueueSweep, SWEEP_INTERVAL_MS);
	// 不阻止进程退出。
	if (typeof sweepTimer.unref === "function") sweepTimer.unref();

	if (isStorageSweepEnabled()) {
		runStorageSweep();
		const intervalMs = boundedIntegerEnv(
			"PPT_STORAGE_SWEEP_MS",
			PPT_STORAGE_DEFAULT_SWEEP_INTERVAL_MS,
			{ min: PPT_STORAGE_MIN_SWEEP_INTERVAL_MS },
		);
		storageSweepTimer = setInterval(runStorageSweep, intervalMs);
		if (typeof storageSweepTimer.unref === "function") storageSweepTimer.unref();
	}
}

export function getPptWorkerRuntimeState() {
	return {
		started,
		activeJobs: activeJobs.size,
		activeProjects: activeProjects.size,
		pollLoops: pollLoops.size,
		expectedPollLoops: started ? getPptConcurrencyLimit() : 0,
	};
}

export async function stopPptWorker(timeoutMs = 20_000): Promise<void> {
	if (!started) return;
	started = false;
	if (sweepTimer) clearInterval(sweepTimer);
	sweepTimer = null;
	if (storageSweepTimer) clearInterval(storageSweepTimer);
	storageSweepTimer = null;
	abortAllPptGenerationsForShutdown();
	await waitForShutdown(
		[
			...activeJobs,
			...pollLoops,
			...(queueSweepInFlight ? [queueSweepInFlight] : []),
			...(storageSweepInFlight ? [storageSweepInFlight] : []),
		],
		timeoutMs,
	);
	await Promise.all(
		[...activeProjects].map(([projectId, lease]) =>
			requeuePptProject(projectId, lease),
		),
	);
}

function runQueueSweep() {
	if (queueSweepInFlight) return;
	queueSweepInFlight = Promise.all([
		sweepStalePptProjects(),
		sweepPendingPptRefunds(),
	])
		.then(([stale, refunds]) => {
			if (stale > 0 || refunds.refunded > 0) {
				logger.warn("ppt-worker", "PPT 队列补偿扫描完成", {
					staleReleased: stale,
					...refunds,
				});
			}
			if (refunds.failed > 0) {
				logger.error("ppt-worker", "PPT 补偿退款仍有失败", refunds);
			}
		})
		.catch((error) => {
			logger.error("ppt-worker", "PPT 队列补偿扫描失败", { error });
		})
		.finally(() => {
			queueSweepInFlight = null;
		});
}

function runStorageSweep() {
	if (storageSweepInFlight) return;
	storageSweepInFlight = sweepPptStorage()
		.then((result) => {
			if (
				result.uploadsRemoved > 0 ||
				result.projectDirsRemoved > 0 ||
				result.projectArtifactsRemoved > 0
			) {
				logger.info("ppt-worker", "PPT 存储清理完成", { ...result });
			}
		})
		.catch((error) => {
			logger.error("ppt-worker", "PPT 存储清理失败", { error });
		})
		.finally(() => {
			storageSweepInFlight = null;
		});
}

function isStorageSweepEnabled() {
	const configured = process.env.PPT_STORAGE_SWEEP_ENABLED?.toLowerCase();
	if (configured) return ["1", "true", "yes", "on"].includes(configured);
	return process.env.NODE_ENV === "production";
}

async function pollLoop(workerIndex: number): Promise<void> {
	while (started) {
		try {
			const claimed = await claimNextPptProject();
			if (claimed) {
				if (!started) {
					await requeuePptProject(claimed.id, claimed.lease);
					break;
				}
				activeProjects.set(claimed.id, claimed.lease);
				const job = processProject(claimed.id, claimed.userId, claimed.lease);
				activeJobs.add(job);
				try {
					await job;
				} finally {
					activeJobs.delete(job);
					if (activeProjects.get(claimed.id) === claimed.lease) {
						activeProjects.delete(claimed.id);
					}
				}
				continue; // 立即尝试下一个，避免空等。
			}
		} catch (error) {
			logger.error("ppt-worker", "轮询/处理失败", { error, workerIndex });
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForShutdown(promises: Promise<unknown>[], timeoutMs: number) {
	return new Promise<boolean>((resolve) => {
		let finished = false;
		const complete = (settled: boolean) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			resolve(settled);
		};
		const timer = setTimeout(() => complete(false), Math.max(0, timeoutMs));
		void Promise.allSettled(promises).then(() => complete(true));
	});
}

/**
 * 处理单个已抢占的项目：重建入参 → 注册取消控制器 → 执行 generatePPT。
 * generatePPT 内部已处理进度/状态/日志的 DB 写入；本函数负责失败/取消时的退款。
 */
async function processProject(
	projectId: string,
	userId: string,
	lease: string,
): Promise<void> {
	const project = await prisma.pptProject.findUnique({
		where: { id: projectId },
		select: { params: true, status: true, workerLease: true },
	});
	if (
		!project ||
		project.status !== "PENDING" ||
		project.workerLease !== lease
	) {
		return;
	}

	const controller = new AbortController();
	const unregister = registerPptGeneration(projectId, controller);
	const heartbeat = createProjectHeartbeat(projectId, lease, controller);
	if (!started) controller.abort(new PptWorkerShutdownError());
	// 关闭「claim→register」窗口内的取消竞态：取消路由可能在此窗口内已把项目标记为
	// FAILED 并退款（此时还未注册控制器无法 abort）。复查状态，若已被取消则直接跳过。
	const afterRegister = await prisma.pptProject.findUnique({
		where: { id: projectId },
		select: { status: true, workerLease: true },
	});
	if (
		afterRegister?.status !== "PENDING" ||
		afterRegister.workerLease !== lease
	) {
		await heartbeat.stop();
		unregister();
		return;
	}
	// SSE 事件在 worker 模式下无处投递（前端改轮询 DB），这里丢弃。
	const noopEmit: EventEmitter = () => {};

	try {
		await heartbeat.refresh();
		if (controller.signal.aborted) {
			throw controller.signal.reason instanceof Error
				? controller.signal.reason
				: new PptLeaseLostError(projectId);
		}
		const params = rebuildGenerationParams(
			projectId,
			userId,
			project.params,
			lease,
		);
		await generatePPT({ ...params, signal: controller.signal }, noopEmit);
	} catch (error) {
		if (isPptPlanningConfirmationRequiredError(error)) return;
		if (isPptLeaseLostError(error)) return;
		if (isPptWorkerShutdown(error)) {
			if (await requeuePptProject(projectId, lease)) {
				await appendProjectLog(
					projectId,
					"PPT worker 停机，任务已重新排队",
				).catch(() => undefined);
			}
			return;
		}
		const cancelled = isPptGenerationCancelled(error);
		const finalized = await prisma.pptProject
			.updateMany({
				where: {
					id: projectId,
					workerLease: lease,
					status: { in: [...PPT_PROCESSING_STATUSES, "FAILED"] },
				},
				data: {
					status: "FAILED",
					workerLease: null,
					currentPhase: cancelled ? "已停止生成" : "生成失败",
					error: cancelled
						? "用户已停止生成"
						: getPptInternalErrorMessage(error),
				},
			})
			.catch((updateError) => {
				onError("ppt-worker", "记录失败状态失败")(updateError);
				return null;
			});
		if (finalized?.count !== 1) return;
		if (!cancelled) {
			await refundPptProjectCredits(
				projectId,
				`PPT 生成失败退款（${projectId}）`,
			).catch(onError("ppt-worker", "失败退款失败"));
		} else {
			await refundPptProjectCredits(
				projectId,
				`PPT 生成停止退款（${projectId}）`,
			).catch(onError("ppt-worker", "停止退款失败"));
			await appendProjectLog(projectId, "用户停止生成").catch(() => undefined);
		}
	} finally {
		await heartbeat.stop();
		unregister();
	}
}

function createProjectHeartbeat(
	projectId: string,
	lease: string,
	controller: AbortController,
) {
	let stopped = false;
	let inFlight: Promise<void> | null = null;
	const refresh = () => {
		if (stopped || inFlight || controller.signal.aborted) return inFlight;
		inFlight = heartbeatPptProject(projectId, lease)
			.then((active) => {
				if (!active && !controller.signal.aborted) {
					controller.abort(new PptLeaseLostError(projectId));
				}
			})
			.catch((error) => {
				logger.error("ppt-worker", "PPT 任务心跳失败", { projectId, error });
			})
			.finally(() => {
				inFlight = null;
			});
		return inFlight;
	};
	const timer = setInterval(() => void refresh(), PROJECT_HEARTBEAT_MS);
	if (typeof timer.unref === "function") timer.unref();
	return {
		refresh,
		async stop() {
			stopped = true;
			clearInterval(timer);
			await inFlight;
		},
	};
}

/**
 * 从 DB 行（params JSON + 行字段）重建 GenerationParams。
 * generate 路由在入队时把完整入参（除 signal 外）序列化进 params 列。
 */
export function rebuildGenerationParams(
	projectId: string,
	userId: string,
	paramsJson: string | null,
	workerLease: string,
): GenerationParams {
	type LegacyStoredGenerationParams = Omit<
		Partial<GenerationParams>,
		"sourceType" | "workerLease" | "signal"
	> & {
		sourceType?: GenerationParams["sourceType"] | "url";
		sourceUrl?: string;
		sourceUrls?: string[];
		templateUrls?: string[];
	};
	const stored: LegacyStoredGenerationParams = (() => {
			if (!paramsJson) return {};
			try {
				return JSON.parse(paramsJson) as LegacyStoredGenerationParams;
		} catch {
			throw new Error("PPT 项目入参损坏，无法重建生成任务。");
		}
		})();
	if (
		stored.sourceType === "url" ||
		stored.sourceUrl ||
		stored.sourceUrls?.length ||
		stored.templateUrls?.length
	) {
		throw new Error("链接型 PPT 输入已停用，请上传文件后重新创建任务。");
	}
	return {
		projectId,
		userId,
		workerLease,
		sourceType: stored.sourceType ?? "topic",
		sourceTopic: stored.sourceTopic,
		sourceFileUrl: stored.sourceFileUrl,
		sourceMarkdown: stored.sourceMarkdown,
		prompt: stored.prompt,
		sourceFileUrls: stored.sourceFileUrls,
		templateFileUrls: stored.templateFileUrls,
		template: stored.template,
		slideCount: stored.slideCount,
		aspectRatio: stored.aspectRatio,
		style: stored.style,
		stylePrompt: stored.stylePrompt,
		styleLabel: stored.styleLabel,
		model: stored.model,
		modelSource: stored.modelSource,
		imageModel: stored.imageModel,
		imageModelSource: stored.imageModelSource,
		imageCountLimit: stored.imageCountLimit,
		imageUnitCreditCost: stored.imageUnitCreditCost,
		textCreditsCost: stored.textCreditsCost,
		retryAttempt: stored.retryAttempt,
		visualReview: stored.visualReview,
		confirmDesign: stored.confirmDesign,
		planningConfirmed: stored.planningConfirmed,
		planningConfirmationStage: stored.planningConfirmationStage,
		textVolume: stored.textVolume,
		audience: stored.audience,
		tone: stored.tone,
		colorPreference: stored.colorPreference,
		typographyPreference: stored.typographyPreference,
	};
}
