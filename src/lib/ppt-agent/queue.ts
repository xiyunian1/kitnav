import { prisma } from "@/lib/db";
import type { PptProjectStatus } from "@prisma/client";
import { refundPptProjectCredits } from "./refund";
import { appendProjectLog } from "./project-log";
import { getStaleActiveProjectMs } from "./timings";
import { onError } from "@/lib/logger";

/**
 * 基于 PostgreSQL 的 PPT 生成任务队列。
 *
 * PptProject 行本身即队列单元：status='QUEUED' 表示已入队待处理。
 * 用 `SELECT ... FOR UPDATE SKIP LOCKED` 原子抢占，天然支持多副本：每个 worker
 * 抢到的都是互不相同的项目，不会重复处理或重复扣费。
 */

const ACTIVE_STATUSES: PptProjectStatus[] = [
	"PENDING",
	"STRATEGIZING",
	"ACQUIRING_IMAGES",
	"EXECUTING",
	"EXPORTING",
];

export interface ClaimedPptProject {
	id: string;
	userId: string;
}

/**
 * 原子抢占一个最早的 QUEUED 项目，置为 PENDING 并刷新 updatedAt。
 * 多个 worker 并发调用时各拿到不同项目；无任务返回 null。
 */
export async function claimNextPptProject(): Promise<ClaimedPptProject | null> {
	const rows = await prisma.$queryRaw<Array<ClaimedPptProject>>`
    UPDATE "PptProject"
    SET "status" = 'PENDING'::"PptProjectStatus", "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "PptProject"
      WHERE "status" = 'QUEUED'::"PptProjectStatus"
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "userId"
  `;
	return rows[0] ?? null;
}

/**
 * 统计当前排队中的项目数（供监控/日志）。
 */
export async function countQueuedPptProjects(): Promise<number> {
	return prisma.pptProject.count({ where: { status: "QUEUED" } });
}

/**
 * 释放一个拓儿（卡死/崩溃）的活跃项目：退款 + 标记 FAILED + 记日志。
 * 幂等：refundPptProjectCredits 用乐观锁保证只退一次。
 */
export async function releaseStaleProject(
	projectId: string,
	reason = "生成任务长时间无进度，已自动释放",
): Promise<void> {
	await refundPptProjectCredits(
		projectId,
		`PPT 生成超时自动释放退款（${projectId}）`,
	).catch(onError("ppt-queue", "超时退款失败"));
	await prisma.pptProject.update({
		where: { id: projectId },
		data: {
			status: "FAILED",
			currentPhase: "生成超时，已自动释放",
			error: "生成任务长时间无进度，已自动释放，请重新生成。",
		},
	});
	await appendProjectLog(projectId, reason);
}

/**
 * 扫描并释放所有超时的活跃项目。健康任务的心跳每 15s 刷新 updatedAt，
 * 因此只有真正拓儿（心跳停止）的项目才会被命中。返回释放数量。
 */
export async function sweepStalePptProjects(now = Date.now()): Promise<number> {
	const since = new Date(now - getStaleActiveProjectMs());
	const stale = await prisma.pptProject.findMany({
		where: { status: { in: ACTIVE_STATUSES }, updatedAt: { lt: since } },
		select: { id: true },
		take: 10,
	});
	for (const project of stale) {
		await releaseStaleProject(project.id);
	}
	return stale.length;
}
