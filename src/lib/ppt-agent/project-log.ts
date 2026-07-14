import { prisma } from "@/lib/db";
// 仅类型导入：编译期擦除，不产生运行时循环依赖。
import type { EventEmitter } from "./generator";

const MAX_PROJECT_LOG_CHARS = 100_000;

/**
 * PPT 项目日志 / 状态更新的公共工具。
 *
 * 之前 4 个 runner 各自维护一份 `log()`，使用「读出 logs → 字符串拼接 → 写回」
 * 的模式，存在两个问题：
 *   1. 竞态：并发写日志（心跳 + 业务日志）会互相覆盖丢日志；
 *   2. O(n²)：每写一条都要把整段历史日志全量读出再写回。
 *
 * 这里改用 PostgreSQL 端的原子追加（单条 UPDATE，服务端字符串拼接），彻底消除
 * 竞态与全量读写，且把重复的样板集中到一处。
 */

export type PptProjectUpdateData = Parameters<
	typeof prisma.pptProject.updateMany
>[0]["data"];

export class PptLeaseLostError extends Error {
	constructor(projectId: string) {
		super(`PPT 任务租约已失效：${projectId}`);
		this.name = "PptLeaseLostError";
	}
}

export function isPptLeaseLostError(error: unknown): error is PptLeaseLostError {
	return (
		error instanceof PptLeaseLostError ||
		(error instanceof Error && error.name === "PptLeaseLostError")
	);
}

/**
 * 向 PptProject.logs 原子追加一行。服务端 CASE 表达式处理 null/空串，避免开头出现多余换行。
 * 单条 UPDATE 自带行锁，并发调用会串行化，不会丢日志。
 */
export async function appendProjectLog(
	projectId: string,
	message: string,
	expectedLease?: string,
): Promise<void> {
	const line = `[${new Date().toISOString()}] ${message}`;
	const updated = expectedLease
		? await prisma.$executeRaw`
	    UPDATE "PptProject"
	    SET "logs" = RIGHT(
	      CASE
	        WHEN "logs" IS NULL OR "logs" = '' THEN ${line}
	        ELSE "logs" || ${"\n" + line}
	      END,
	      CAST(${MAX_PROJECT_LOG_CHARS} AS integer)
	    )
	    WHERE "id" = ${projectId} AND "workerLease" = ${expectedLease}
	  `
		: await prisma.$executeRaw`
	    UPDATE "PptProject"
	    SET "logs" = RIGHT(
	      CASE
	        WHEN "logs" IS NULL OR "logs" = '' THEN ${line}
	        ELSE "logs" || ${"\n" + line}
	      END,
	      CAST(${MAX_PROJECT_LOG_CHARS} AS integer)
	    )
	    WHERE "id" = ${projectId}
	  `;
	if (expectedLease && updated !== 1) throw new PptLeaseLostError(projectId);
}

/**
 * 既向 SSE 流推送一条日志事件，又把带时间戳的行原子追加进数据库。
 * 替代各 runner 内重复的 log() 实现。
 */
export async function emitProjectLog(
	projectId: string,
	emit: EventEmitter,
	message: string,
	expectedLease?: string,
): Promise<void> {
	emit({ type: "log", data: { message } });
	await appendProjectLog(projectId, message, expectedLease);
}

/**
 * 更新 PptProject 的任意字段。集中封装，便于统一替换调用方式。
 */
export async function updateProject(
	projectId: string,
	data: PptProjectUpdateData,
	expectedLease: string,
): Promise<void> {
	const updated = await prisma.pptProject.updateMany({
		where: { id: projectId, workerLease: expectedLease },
		data,
	});
	if (updated.count !== 1) throw new PptLeaseLostError(projectId);
}
