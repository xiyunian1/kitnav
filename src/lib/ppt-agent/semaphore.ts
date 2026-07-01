/**
 * 信号量：控制 PPT 生成的并发数
 * 防止 Claude API rate limit 和成本失控
 */

export class Semaphore {
	private current = 0;
	private queue: Array<() => void> = [];

	constructor(private max: number) {}

	async acquire(): Promise<void> {
		if (this.current < this.max) {
			this.current++;
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});
	}

	release(): void {
		this.current--;
		const next = this.queue.shift();
		if (next) {
			this.current++;
			next();
		}
	}

	getCurrent(): number {
		return this.current;
	}

	getQueueLength(): number {
		return this.queue.length;
	}
}

// 全局信号量：控制单进程内 PPT 生成的并发数。
// 异步化后，跨副本的任务分布由 Postgres 队列的 SELECT ... FOR UPDATE SKIP LOCKED
// 保证（每个 worker 抢到的项目互不相同，不会重复处理或重复扣费），因此多副本水平扩容是安全的。
// 本信号量仅限「单副本内」并发上限；全局总并发 = 本值 × 副本数。
// 如需「硬性全局并发上限」（跨副本），可后续用 Postgres 计数行 + FOR UPDATE 实现。
const DEFAULT_PPT_CONCURRENCY = 3;
export const pptSemaphore = new Semaphore(
	Math.max(
		1,
		Number(process.env.PPT_AGENT_MAX_CONCURRENT || DEFAULT_PPT_CONCURRENCY),
	),
);
