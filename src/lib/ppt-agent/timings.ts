/**
 * PPT 生成相关的运行期时长阈值，集中定义供 generate 路由与 worker 共享，
 * 避免阈值逻辑在多处复制导致漂移。
 */

import {
	boundedIntegerEnv,
	MAX_NODE_TIMER_MS,
} from "@/lib/runtime-config";

const DEFAULT_STALE_BUFFER_MS = 10 * 60 * 1000;
export const DEFAULT_PPT_AGENT_TIMEOUT_MS = 1000 * 60 * 60 * 2;

export function getPptAgentTimeoutMs(
	environment: Readonly<Record<string, string | undefined>> = process.env,
) {
	return boundedIntegerEnv(
		"PPT_AGENT_TIMEOUT_MS",
		DEFAULT_PPT_AGENT_TIMEOUT_MS,
		{ min: 1_000, environment },
	);
}

/**
 * 孤儿任务恢复阈值：项目处于活跃状态但超过此时长未更新进度，视为生成进程已成孤儿
 * （被平台 maxDuration 中断、进程崩溃等）。
 *
 * 健康的 pi 生成任务每 15s 更新 updatedAt，因此该阈值实际只接管「孤儿任务」。
 *
 * - pi agent 单轮默认 2h（PPT_AGENT_TIMEOUT_MS），故默认取 agent 超时 + 10 分钟缓冲，
 *   避免在 agent 合法最长运行时长内过早释放仍可能存活的任务；
 * - 用户显式设置 PPT_STALE_ACTIVE_PROJECT_MS 时始终以用户值为准。
 */
export function getStaleActiveProjectMs(
	environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
	const fallback = getPptAgentTimeoutMs(environment) + DEFAULT_STALE_BUFFER_MS;
	return boundedIntegerEnv("PPT_STALE_ACTIVE_PROJECT_MS", fallback, {
		min: 1_000,
		max: MAX_NODE_TIMER_MS + DEFAULT_STALE_BUFFER_MS,
		environment,
	});
}
