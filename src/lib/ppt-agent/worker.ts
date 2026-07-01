import { prisma } from "@/lib/db";
import {
	generatePPT,
	type EventEmitter,
	type GenerationParams,
} from "./generator";
import { claimNextPptProject, sweepStalePptProjects } from "./queue";
import {
	isPptGenerationCancelled,
	registerPptGeneration,
} from "./cancellation";
import { refundPptProjectCredits } from "./refund";
import { logger, onError } from "@/lib/logger";
import { appendProjectLog } from "./project-log";

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
 * 启动：startPptWorker() 幂等，首次 generate 请求时触发；进程存活期间持续运行。
 * 进程重启后 QUEUED 任务会在下一次请求触发启动时被重新消费。
 */

const POLL_INTERVAL_MS = Number(process.env.PPT_WORKER_POLL_MS || 2000);
const SWEEP_INTERVAL_MS = Number(process.env.PPT_WORKER_SWEEP_MS || 30_000);

let started = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startPptWorker(): void {
	if (started) return;
	started = true;

	// 主轮询循环：自驱动，有任务则串行处理（generatePPT 内部信号量控制并发上限），
	// 无任务时按 POLL_INTERVAL_MS 退避。
	void pollLoop();

	// 周期性孤儿扫描：释放心跳停止的拓儿项目（退款 + 标记失败），自愈崩溃场景。
	sweepTimer = setInterval(() => {
		sweepStalePptProjects().catch((error) => {
			logger.error("ppt-worker", "孤儿扫描失败", { error });
		});
	}, SWEEP_INTERVAL_MS);
	// 不阻止进程退出。
	if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

async function pollLoop(): Promise<void> {
	while (started) {
		try {
			const claimed = await claimNextPptProject();
			if (claimed) {
				await processProject(claimed.id, claimed.userId);
				continue; // 立即尝试下一个，避免空等。
			}
		} catch (error) {
			logger.error("ppt-worker", "轮询/处理失败", { error });
		}
		await sleep(POLL_INTERVAL_MS);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 处理单个已抢占的项目：重建入参 → 注册取消控制器 → 执行 generatePPT。
 * generatePPT 内部已处理进度/状态/日志的 DB 写入；本函数负责失败/取消时的退款。
 */
async function processProject(
	projectId: string,
	userId: string,
): Promise<void> {
	const project = await prisma.pptProject.findUnique({
		where: { id: projectId },
		select: { params: true, status: true },
	});
	if (!project || project.status !== "PENDING") return;

	const controller = new AbortController();
	const unregister = registerPptGeneration(projectId, controller);
	// 关闭「claim→register」窗口内的取消竞态：取消路由可能在此窗口内已把项目标记为
	// FAILED 并退款（此时还未注册控制器无法 abort）。复查状态，若已被取消则直接跳过。
	const afterRegister = await prisma.pptProject.findUnique({
		where: { id: projectId },
		select: { status: true },
	});
	if (afterRegister?.status !== "PENDING") {
		unregister();
		return;
	}
	// SSE 事件在 worker 模式下无处投递（前端改轮询 DB），这里丢弃。
	const noopEmit: EventEmitter = () => {};

	try {
		const params = rebuildGenerationParams(projectId, userId, project.params);
		await generatePPT({ ...params, signal: controller.signal }, noopEmit);
	} catch (error) {
		const cancelled = isPptGenerationCancelled(error);
		if (!cancelled) {
			// 失败退款；取消场景 generatePPT 已写「已停止生成」状态，这里补退款即可。
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
		unregister();
	}
}

/**
 * 从 DB 行（params JSON + 行字段）重建 GenerationParams。
 * generate 路由在入队时把完整入参（除 signal 外）序列化进 params 列。
 */
function rebuildGenerationParams(
	projectId: string,
	userId: string,
	paramsJson: string | null,
): GenerationParams {
	const stored: Partial<GenerationParams> = (() => {
		if (!paramsJson) return {};
		try {
			return JSON.parse(paramsJson) as Partial<GenerationParams>;
		} catch {
			throw new Error("PPT 项目入参损坏，无法重建生成任务。");
		}
	})();
	return {
		projectId,
		userId,
		sourceType: stored.sourceType ?? "topic",
		sourceTopic: stored.sourceTopic,
		sourceFileUrl: stored.sourceFileUrl,
		sourceUrl: stored.sourceUrl,
		sourceMarkdown: stored.sourceMarkdown,
		prompt: stored.prompt,
		sourceUrls: stored.sourceUrls,
		sourceFileUrls: stored.sourceFileUrls,
		templateUrls: stored.templateUrls,
		template: stored.template,
		slideCount: stored.slideCount,
		aspectRatio: stored.aspectRatio,
		style: stored.style,
		stylePrompt: stored.stylePrompt,
		styleLabel: stored.styleLabel,
	};
}
