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

// 全局信号量：最多 3 个并发 PPT 生成任务
export const pptSemaphore = new Semaphore(3);
