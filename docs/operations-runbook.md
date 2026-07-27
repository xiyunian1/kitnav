# 生产运行手册

## 每次发布

```bash
npm run prod:check-env
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run prod:build-images
npm run prod:compose -- stop app image-worker ppt-worker
npm run prod:backup
npm run prod:backup:verify -- --snapshot data/backups/<timestamp>
npm run prod:compose -- up -d --no-build
npm run prod:compose -- ps
```

如果停机后的备份或校验失败，立即用 `npm run prod:compose -- start app image-worker ppt-worker`
恢复旧版本服务，不要让应用因发布脚本失败而持续停机。

Compose 会分别构建 Web、图片 Worker 和 PPT Worker 镜像。只有 PPT Worker
包含 Python、字体、PI 与压缩包工具，避免 Web 和图片 Worker 携带无关的大型运行时。
顺序构建脚本也规避了部分 Docker Desktop 版本在非 ASCII 项目路径下并行构建失败的问题。
容器只保留目录授权、降权和 init 信号转发所需的 `CHOWN`、`KILL`、`SETGID`、`SETUID`；
Node 进程以 UID 1000 运行且不保留有效 capability。
Caddy 使用只读根文件系统，仅保留绑定 80/443 端口所需的 capability，并设置独立资源上限。
PostgreSQL 同样使用只读根文件系统和最小 capability；所有容器日志默认限制为 5 个 10MB 文件，防止 Docker 日志持续占满磁盘。
Web 启动会先在 migration 事务外并发补齐查询索引，再执行 `prisma migrate deploy`。不要绕过 `scripts/migrate-production-db.sh` 直接对已有生产库运行待发布 migration。

发布后检查 `/api/health/ready`，该接口会核对数据库 migration 和队列关键字段；再分别创建一个最小图片任务和 PPT 任务，确认扣费、完成、下载和失败退款。

在 VPS 项目目录运行以下命令可一次检查 Compose 服务、公开存活/就绪端点、磁盘空间、数据库延迟、队列积压和待退款任务。命令读取 `.env.production`，任一指标越过阈值时以非零状态退出，可直接接入 cron、systemd timer 或现有监控平台：

```bash
npm run prod:health
```

外部监控节点无法访问 Docker 时可运行 `npm run prod:health -- --skip-docker --env-file /path/to/monitor.env`。默认阈值及可覆盖的 `PROD_HEALTH_*` 配置列在 `.env.production.example`。

`/api/health/metrics` 提供 Prometheus 文本指标，必须使用
`Authorization: Bearer <METRICS_TOKEN>`。建议至少告警：磁盘可用空间低于 15%、数据库连接达到 80%、`ai_aggregator_queue_jobs{state="stale"}` 大于 0、`ai_aggregator_queue_utilization_ratio` 达到 90%、`ai_aggregator_ppt_pending_refunds` 持续大于 0、队列最老任务超过正常超时、最近一小时失败率突增、数据库查询延迟持续升高。

Web、图片 Worker 和 PPT Worker 的 Prisma 连接池默认分别限制为 10、5、5，
`npm run prod:check-env` 会校验三者总预算不超过 PostgreSQL 最大连接数扣除
`DATABASE_RESERVED_CONNECTIONS` 后的余量。不要只在共享 `DATABASE_URL` 中增大
`connection_limit`，该参数会同时作用于三个进程；调整后同时观察
`ai_aggregator_database_connections` 和数据库查询延迟。

## 定期备份

建议至少每日执行一次，并把镜像目录挂载到 VPS 之外的加密存储：

```bash
npm run prod:compose -- stop app image-worker ppt-worker
npm run prod:backup -- --keep 30 --mirror-dir /mnt/offsite/ai-aggregator
npm run prod:compose -- start app image-worker ppt-worker
```

备份、恢复和恢复演练默认读取 `.env.production`，可通过 `PRODUCTION_ENV_FILE` 或
`--env-file` 指定其他文件。备份默认拒绝在 Web 或 Worker 运行时继续；只有在明确接受
数据库与文件可能不处于同一时间点时，才使用 `--allow-live-writers true`。

至少每月执行一次恢复演练：

```bash
npm run prod:restore:drill -- --snapshot data/backups/<timestamp>
```

恢复演练只创建临时数据库和临时文件目录，完成后自动清理，不影响线上库。

## 实际恢复

1. 确认目标快照校验通过。
2. 为当前线上状态再创建一份快照。
3. 停止 Web 和两个 Worker，只保留 PostgreSQL：

```bash
npm run prod:compose -- stop app image-worker ppt-worker
```

4. 执行恢复。已有数据库和文件目录需要显式允许替换：

```bash
npm run prod:restore -- \
  --snapshot data/backups/<timestamp> \
  --target-database ai_aggregator \
  --data-dir data \
  --replace-database true \
  --replace-files true \
  --confirm RESTORE:ai_aggregator
```

恢复先写入临时数据库。切换时，旧数据库会重命名为 `ai_aggregator_pre_<timestamp>`，旧文件目录会重命名为 `*.pre-restore-<timestamp>`。如果切换中途失败，脚本会补偿恢复原数据库和原文件目录；若补偿本身失败，命令会返回非零状态并保留回滚副本供人工处理。确认新数据无误后再手动清理这些回滚副本。

5. 启动服务。Web 启动时会对恢复后的数据库执行尚未应用的 migrations：

```bash
npm run prod:compose -- up -d
```

## 故障判断

- Web `unhealthy`：检查 `/api/health/ready`、数据库连接和 migration 日志。
- 图片 Worker `unhealthy`：检查数据库心跳文件、消费循环数和图片上游连接。
- PPT Worker `unhealthy`：检查数据库心跳、Pi 进程、Python 工具链和持久化目录权限。
- 磁盘增长：检查 `data/uploads`、`data/ppt-projects`、`data/backups` 和异地镜像保留数。
- 上传孤儿：图片 Worker 默认每 6 小时扫描一次，删除超过 24 小时且未被素材、图片会话或反馈引用的图片；可通过 `UPLOAD_STORAGE_SWEEP_MS` 和 `UPLOAD_ORPHAN_RETENTION_HOURS` 调整。心跳文件的 `uploadStorageSweep` 会记录最近开始/结束时间、删除计数和错误。
- 上传文件：`data/uploads` 只能挂载到 `/app/data/uploads`，禁止重新挂载到 Next 的 `public` 目录；旧 `/uploads/*` 链接由 Caddy 重写到鉴权接口。
- 队列卡住：先确认 Worker 健康，再看任务 `heartbeatAt` 或项目 `updatedAt`；不要直接修改积分。
- Redis 不健康：应用自动回退 PostgreSQL 限流与直查，功能不受影响，仅性能回落；`/api/health/metrics` 的 `ai_aggregator_redis_up` 为 0 时检查 `ai-aggregator-redis` 容器。Redis 为纯缓存（无持久化、`noeviction`），达到内存上限后新写入会回退 PostgreSQL；可随时重启或 `FLUSHALL`，副作用只有限流窗口重置和 30 秒内缓存重建。

## 游客展示模式

- 开启：在 `.env.production` 设置 `GUEST_MODE_ENABLED="true"`（仅字面值 `true` 生效）后重启 `app`。登录页出现“游客参观”入口。
- 关闭：改回 `"false"` 并重启 `app`。中间件会立即拒绝存量游客会话（页面重定向到登录页，API 返回 403），无需手动清理 cookie。
- 游客账号是数据库中的固定用户 `guest-showcase`（角色 `GUEST`），首次游客登录时自动创建；它不计入注册上限和用户统计，后台不能修改其角色、状态或积分。
- 游客的所有非只读 HTTP 请求（除 `/api/auth/*`）由中间件统一 403，服务端是唯一防线；如需彻底移除入口，关闭开关即可，无需删除该用户。

## 回滚

- 应用回滚：使用上一版本镜像启动，数据库 migration 必须保持向后兼容。
- 数据回滚：停止应用，使用恢复时保留的旧数据库和旧文件目录切回。
- 不要用 `prisma db push` 修复生产结构；只能通过新 migration 前进修复。
