# 方案 B 多用户并发分析与解决方案

## 并发风险点

### 1. Claude API 速率限制（最大风险）

**问题**：
- Anthropic API 有严格的 rate limit（按 tier）
- 示例（Tier 2）：
  - 每分钟 4000 requests
  - 每天 300,000 requests
  - 每分钟 400,000 tokens
- **单个 PPT 项目消耗**：
  - Strategist：1 次请求，~10k tokens
  - Executor：10 页 × 1 次 = 10 次请求，~50k tokens
  - 总计：11 次请求，60k tokens
- **10 个用户同时生成**：
  - 110 次请求/分钟（远低于 4000 限制）
  - 600k tokens/分钟（**超过 400k 限制** ⚠️）

**结果**：触发 429 rate limit → 所有用户请求失败

### 2. 服务器资源竞争

**内存**：
- 每个生成任务需加载：
  - Role prompts（10-15k tokens，~40KB）
  - spec_lock.md（~20KB）
  - 前序页面 SVG（累积，10页 × 50KB = 500KB）
  - Node.js 进程本身（~50MB）
- **10 个并发任务**：~600MB 额外内存（可接受）

**CPU**：
- Node.js 单线程，但主要是 I/O 等待（API 调用）
- 实际 CPU 占用不高（<20%）

**文件系统 I/O**：
- 并发写入不同项目目录（projects/<id>/）
- 无冲突，但磁盘 I/O 会累加

### 3. 成本累积

**平台 API Key 模式**：
- 10 用户同时生成 = $6/分钟 = $360/小时
- 如果没有并发控制，成本可能失控

**用户自带 Key 模式**：
- 平台无成本压力
- 但用户的 key 也有 rate limit（可能更低）

### 4. 数据库并发

**PostgreSQL + Prisma**：
- ✅ 天然支持并发写入（ACID）
- ✅ 不同用户的 `PptProject` 记录独立
- ✅ 无问题

---

## 解决方案

### 方案 1：队列机制（推荐）

**架构**：
```typescript
// src/lib/ppt-agent/queue.ts

import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

// 创建队列
export const pptQueue = new Queue("ppt-generation", { connection: redis });

// 限流配置
const queueOptions = {
  limiter: {
    max: 3,        // 最多 3 个并发任务
    duration: 1000, // 每秒
  },
};

// 添加生成任务
export async function enqueueGeneration(projectId: string, params: GenerationParams) {
  await pptQueue.add(
    "generate",
    { projectId, params },
    {
      priority: params.usedOwnKey ? 1 : 2, // 用户自带 key 优先
      attempts: 2, // 失败重试 2 次
      backoff: { type: "exponential", delay: 5000 },
    }
  );
  
  return await getQueuePosition(projectId);
}

// 获取排队位置
async function getQueuePosition(projectId: string): Promise<number> {
  const waiting = await pptQueue.getWaiting();
  const index = waiting.findIndex((job) => job.data.projectId === projectId);
  return index + 1; // 第 N 位
}

// Worker 处理任务
const worker = new Worker(
  "ppt-generation",
  async (job) => {
    const { projectId, params } = job.data;
    
    // 更新数据库状态
    await prisma.pptProject.update({
      where: { id: projectId },
      data: { status: "PROCESSING" },
    });
    
    // 调用生成逻辑
    await generatePPT(projectId, params);
  },
  { connection: redis, concurrency: 3 }
);

worker.on("completed", (job) => {
  console.log(`✅ 项目 ${job.data.projectId} 生成完成`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ 项目 ${job.data.projectId} 失败:`, err);
  prisma.pptProject.update({
    where: { id: job.data.projectId },
    data: { status: "FAILED", error: err.message },
  });
});
```

**API 改造**：
```typescript
// src/app/api/ppt/generate/route.ts

export async function POST(req: Request) {
  const session = await auth();
  const params = await req.json();
  
  // 创建项目记录
  const project = await prisma.pptProject.create({
    data: {
      userId: session!.user.id,
      title: params.sourceTopic,
      status: "QUEUED", // 排队中
      ...params,
    },
  });
  
  // 加入队列
  const position = await enqueueGeneration(project.id, params);
  
  return Response.json({
    projectId: project.id,
    status: "QUEUED",
    queuePosition: position,
    message: `已加入队列，当前排队第 ${position} 位`,
  });
}

// 轮询接口（前端定时查询进度）
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  
  const project = await prisma.pptProject.findUnique({
    where: { id: projectId },
  });
  
  if (project.status === "QUEUED") {
    const position = await getQueuePosition(projectId);
    return Response.json({ status: "QUEUED", queuePosition: position });
  }
  
  return Response.json(project);
}
```

**前端展示**：
```tsx
// 创建后轮询状态
const { projectId } = await fetch("/api/ppt/generate", { method: "POST", body });

const interval = setInterval(async () => {
  const res = await fetch(`/api/ppt/projects/${projectId}`);
  const data = await res.json();
  
  if (data.status === "QUEUED") {
    setStatus(`排队中：当前第 ${data.queuePosition} 位`);
  } else if (data.status === "PROCESSING") {
    setStatus(`生成中：${data.progress}%`);
  } else if (data.status === "COMPLETED") {
    clearInterval(interval);
    setStatus("完成！");
  }
}, 2000); // 每 2 秒查询一次
```

**优势**：
- ✅ 精确控制并发数（如 3 个）
- ✅ 失败自动重试
- ✅ 用户看到排队位置（体验透明）
- ✅ 防止 rate limit
- ✅ 防止成本失控

**成本**：
- 需要 Redis（可用 Upstash 免费版）

---

### 方案 2：信号量限流（轻量级）

如果不想引入 Redis，可以用内存信号量：

```typescript
// src/lib/ppt-agent/semaphore.ts

class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];
  
  constructor(private max: number) {}
  
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    
    return new Promise((resolve) => {
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
}

export const pptSemaphore = new Semaphore(3); // 最多 3 个并发

// 使用
export async function generatePPT(projectId: string) {
  await pptSemaphore.acquire();
  
  try {
    // 生成逻辑...
  } finally {
    pptSemaphore.release();
  }
}
```

**劣势**：
- ❌ 重启服务后队列丢失
- ❌ 无法跨实例共享（多服务器部署时失效）
- ❌ 无排队位置展示

---

### 方案 3：按用户限流

```typescript
// 每个用户最多 1 个进行中的项目
export async function POST(req: Request) {
  const session = await auth();
  
  const activeProject = await prisma.pptProject.findFirst({
    where: {
      userId: session!.user.id,
      status: { in: ["QUEUED", "PROCESSING"] },
    },
  });
  
  if (activeProject) {
    return Response.json(
      { error: "您有一个项目正在生成中，请等待完成后再创建新项目" },
      { status: 429 }
    );
  }
  
  // 继续创建...
}
```

**优势**：
- ✅ 最简单（无需额外依赖）
- ✅ 防止单用户刷量

**劣势**：
- ❌ 无法控制全局并发（100 个用户同时生成仍会超限）

---

## 综合建议

### 阶段 1：MVP（快速上线）
使用 **方案 3（按用户限流）+ 方案 2（内存信号量）**：
```typescript
// 全局限制 3 个并发
await pptSemaphore.acquire();

// 每用户限制 1 个进行中项目
if (await hasActiveProject(userId)) {
  return error(429);
}
```

**适用场景**：
- 用户量小（<100）
- 单服务器部署
- 预算有限

---

### 阶段 2：生产环境（可扩展）
使用 **方案 1（BullMQ 队列）**：
- Redis 队列（持久化、可观测）
- 精确控制并发
- 支持多服务器部署

**部署配置**：
```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    
  app:
    environment:
      REDIS_URL: redis://redis:6379
      PPT_MAX_CONCURRENCY: 3
```

---

## Rate Limit 应对策略

### 1. 分级 API Key 池
```typescript
const apiKeys = {
  tier2: [process.env.CLAUDE_KEY_1, process.env.CLAUDE_KEY_2],
  tier3: [process.env.CLAUDE_KEY_3],
};

// 轮询使用
let currentKeyIndex = 0;
function getNextKey() {
  const key = apiKeys.tier2[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.tier2.length;
  return key;
}
```

### 2. 指数退避重试
```typescript
async function callClaude(prompt: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await anthropic.messages.create({ ... });
    } catch (err) {
      if (err.status === 429) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}
```

### 3. 用户自带 Key 优先
```typescript
// 用户自带 key 的请求跳过队列限制
if (params.usedOwnKey) {
  await generatePPT(projectId, params); // 立即执行
} else {
  await enqueueGeneration(projectId, params); // 进队列
}
```

---

## 成本控制

### 1. 积分预扣费 + 失败退款
```typescript
// 生成前扣费
await deductCredits(userId, estimatedCost);

try {
  await generatePPT(projectId);
} catch (err) {
  // 失败退款
  await refundCredits(userId, estimatedCost);
}
```

### 2. 每日生成次数限制
```typescript
const todayCount = await prisma.pptProject.count({
  where: {
    userId,
    createdAt: { gte: startOfDay(new Date()) },
  },
});

if (todayCount >= 10) {
  return error("今日生成次数已达上限（10次）");
}
```

---

## 监控与告警

```typescript
// src/lib/monitoring.ts

import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("ppt-generation");

const activeGenerations = meter.createUpDownCounter("ppt.active_generations");
const rateLimitErrors = meter.createCounter("ppt.rate_limit_errors");
const totalCost = meter.createCounter("ppt.total_cost_usd");

export function trackGeneration(projectId: string) {
  activeGenerations.add(1, { projectId });
  
  return () => {
    activeGenerations.add(-1, { projectId });
  };
}

// 告警规则
if (activeGenerations.value > 5) {
  notifySlack("⚠️ PPT 并发数超过 5，可能触发 rate limit");
}
```

---

## 总结

| 方案 | 并发控制 | 成本控制 | 用户体验 | 复杂度 |
|------|---------|---------|---------|--------|
| 按用户限流 | ⚠️ 弱（无全局限制） | ✅ 好 | ⚠️ 一般 | ⭐ 低 |
| 内存信号量 | ✅ 中（单实例有效） | ✅ 好 | ⚠️ 无排队展示 | ⭐⭐ 中 |
| BullMQ 队列 | ✅✅ 强（跨实例） | ✅✅ 优秀 | ✅✅ 透明排队 | ⭐⭐⭐ 高 |

**我的建议**：
- **MVP 阶段**：方案 3（按用户限流）+ 方案 2（内存信号量）
- **生产环境**：方案 1（BullMQ 队列）+ Rate limit 应对策略

**关键指标监控**：
- 实时并发数
- API rate limit 命中率
- 平均生成时长
- 成本/项目

你觉得这个分析如何？需要我先实现 MVP 版本（方案 2+3）吗？
