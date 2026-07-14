import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { refundPptProjectCredits } from "./refund";
import { appendProjectLog } from "./project-log";
import { getStaleActiveProjectMs } from "./timings";
import { onError } from "@/lib/logger";
import { PPT_RUNNING_STATUSES, PPT_PROCESSING_STATUSES } from "./status";

/**
 * 基于 PostgreSQL 的 PPT 生成任务队列。
 *
 * PptProject 行本身即队列单元：status='QUEUED' 表示已入队待处理。
 * 用 `SELECT ... FOR UPDATE SKIP LOCKED` 原子抢占，天然支持多副本：每个 worker
 * 抢到的都是互不相同的项目，不会重复处理或重复扣费。
 */

export interface ClaimedPptProject {
	id: string;
	userId: string;
	lease: string;
}

export interface ReleaseStaleProjectOptions {
	expectedLease?: string | null;
	staleBefore?: Date;
}

/**
 * 原子抢占一个最早的 QUEUED 项目，置为 PENDING 并刷新 updatedAt。
 * 多个 worker 并发调用时各拿到不同项目；无任务返回 null。
 */
export async function claimNextPptProject(): Promise<ClaimedPptProject | null> {
	const lease = randomUUID();
	const rows = await prisma.$queryRaw<Array<Omit<ClaimedPptProject, "lease">>>`
	    UPDATE "PptProject"
	    SET
	      "status" = 'PENDING'::"PptProjectStatus",
	      "workerLease" = ${lease},
	      "updatedAt" = NOW()
	    WHERE "id" = (
	      SELECT "id" FROM "PptProject"
	      WHERE "status" = 'QUEUED'::"PptProjectStatus"
	        AND "workerLease" IS NULL
	      ORDER BY "createdAt" ASC
	      FOR UPDATE SKIP LOCKED
	      LIMIT 1
	    )
	    RETURNING "id", "userId"
	  `;
	return rows[0] ? { ...rows[0], lease } : null;
}

export async function heartbeatPptProject(projectId: string, lease: string) {
	const updated = await prisma.pptProject.updateMany({
		where: {
			id: projectId,
			workerLease: lease,
			status: { in: [...PPT_RUNNING_STATUSES] },
		},
		data: { updatedAt: new Date() },
	});
	return updated.count === 1;
}

export async function requeuePptProject(projectId: string, lease: string) {
	const updated = await prisma.pptProject.updateMany({
		where: {
			id: projectId,
			workerLease: lease,
			status: { in: [...PPT_RUNNING_STATUSES] },
		},
		data: {
			status: "QUEUED",
			workerLease: null,
			currentPhase: "worker 重启，任务已重新排队",
			error: null,
		},
	});
	return updated.count === 1;
}

/**
 * 统计当前排队中的项目数（供监控/日志）。
 */
export async function countQueuedPptProjects(): Promise<number> {
	return prisma.pptProject.count({
		where: { status: "QUEUED", workerLease: null },
	});
}

/**
 * 释放一个卡死/崩溃的活跃项目：退款 + 标记 FAILED + 记日志。
 * 幂等：refundPptProjectCredits 用乐观锁保证只退一次。
 */
export async function releaseStaleProject(
	projectId: string,
	reason = "生成任务长时间无进度，已自动释放",
	options: ReleaseStaleProjectOptions = {},
): Promise<boolean> {
	let expectedLease = options.expectedLease;
	if (!("expectedLease" in options)) {
		const project = await prisma.pptProject.findFirst({
			where: { id: projectId, status: { in: [...PPT_PROCESSING_STATUSES] } },
			select: { workerLease: true },
		});
		if (!project) return false;
		expectedLease = project.workerLease;
	}
	const claimed = await prisma.pptProject.updateMany({
		where: {
			id: projectId,
			status: { in: [...PPT_PROCESSING_STATUSES] },
			workerLease: expectedLease ?? null,
			...(options.staleBefore
				? { updatedAt: { lt: options.staleBefore } }
				: {}),
		},
		data: {
			status: "FAILED",
			workerLease: null,
			currentPhase: "生成超时，已自动释放",
			error: "生成任务长时间无进度，已自动释放，请重新生成。",
		},
	});
	if (claimed.count !== 1) return false;

	await refundPptProjectCredits(
		projectId,
		`PPT 生成超时自动释放退款（${projectId}）`,
	).catch(onError("ppt-queue", "超时退款失败"));
	await appendProjectLog(projectId, reason);
	return true;
}

/**
 * 扫描并释放所有超时的活跃项目。健康任务会定期刷新 updatedAt，
 * 因此只有真正卡死（心跳停止）的项目才会被命中。返回释放数量。
 */
export async function sweepStalePptProjects(now = Date.now()): Promise<number> {
	const since = new Date(now - getStaleActiveProjectMs());
	const stale = await prisma.pptProject.findMany({
		where: { status: { in: [...PPT_RUNNING_STATUSES] }, updatedAt: { lt: since } },
		select: { id: true, workerLease: true },
		orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
		take: 10,
	});
	let released = 0;
	for (const project of stale) {
		if (
			await releaseStaleProject(project.id, undefined, {
				expectedLease: project.workerLease,
				staleBefore: since,
			})
		) {
			released += 1;
		}
	}
	return released;
}
