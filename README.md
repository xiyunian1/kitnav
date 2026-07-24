# AI 聚合站

基于 Next.js 的 AI 创作平台，包含图片创作、PPT Master 生成、素材库、积分充值、BYOK API 配置和管理后台。

## 技术栈

- Next.js 16 App Router、React 19、TypeScript
- PostgreSQL 16、Prisma 6、Auth.js v5
- Tailwind CSS v4、Radix UI
- 独立图片 Worker、独立 PPT Worker、Pi Coding Agent、PPT Master Python 工具链
- Docker Compose、Caddy

## 本地开发

使用 `.node-version` 中固定的 Node.js 版本。先启动 PostgreSQL，并在 `.env` 配置 `DATABASE_URL`、`AUTH_SECRET` 和 `ENCRYPTION_KEY`。

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

`db:seed` 会初始化系统设置和充值套餐。只有同时配置非占位的 `ADMIN_EMAIL` 与至少 12 位的 `ADMIN_PASSWORD` 时才会创建管理员；创建完成后不要长期保留管理员明文口令。

图片和 PPT 都使用持久化数据库队列。本地开发时分别打开终端运行：

```bash
npm run image-worker:dev
npm run ppt-worker:dev
```

`db:push` 仅用于本地开发。生产环境只使用版本化 Prisma migrations。

## 生产部署

1. 按 [`.env.production.example`](./.env.production.example) 准备 `.env.production`。
2. 运行 `npm run prod:check-env`。
3. 运行 `npm test`、`npm run lint`、`npx tsc --noEmit` 和 `npm run build`。
4. 对现有线上数据执行 `npm run prod:backup`，随后执行备份校验。
5. 构建并启动 Compose 服务。

```bash
npm run prod:backup
npm run prod:backup:verify -- --snapshot data/backups/<timestamp>
npm run prod:build-images
npm run prod:compose -- up -d --no-build
npm run prod:compose -- ps
```

`postgres`、`app`、`image-worker`、`ppt-worker` 和 `caddy` 应全部健康。Web 健康检查访问 `/api/health/ready` 并真实查询数据库。

Web 容器启动时执行 `prisma migrate deploy`。历史 `db push` 数据库只有在实时结构与基线完全一致时才会记录基线；发现结构漂移会拒绝启动。
启动脚本会先在 migration 事务外并发创建缺失的查询索引，再执行版本化 migration。已有生产表不会因普通索引构建长时间阻塞写入；空数据库直接由 migration 初始化。

## 备份与恢复

```bash
npm run prod:compose -- stop app image-worker ppt-worker
npm run prod:backup
npm run prod:backup:verify -- --snapshot data/backups/<timestamp>
npm run prod:compose -- start app image-worker ppt-worker
npm run prod:restore:drill -- --snapshot data/backups/<timestamp>
```

备份默认从 `.env.production`（或 `PRODUCTION_ENV_FILE`）读取 Compose 变量，并拒绝在
Web 或 Worker 仍在写数据时创建快照，避免数据库与文件不属于同一停机点。
`--allow-live-writers true` 只用于明确接受该一致性风险的场景。

每个快照包含：

- `database.dump`：PostgreSQL custom format 备份。
- `files.tar.gz`：素材、图片任务输入、PPT 上传和项目产物。
- `manifest.json`：版本、时间、文件大小和 SHA-256 校验和。

默认保留 5 个快照。通过 `BACKUP_MIRROR_DIR` 或 `--mirror-dir` 可原子镜像到 VPS 之外的挂载存储：

```bash
npm run prod:backup -- --keep 30 --mirror-dir /mnt/offsite/ai-aggregator
```

实际恢复要求先停止 `app`、`image-worker` 和 `ppt-worker`，并提供精确确认字符串。恢复过程先写入临时数据库，覆盖时保留旧数据库和旧文件目录；切换中途失败时会自动尝试恢复原数据库和文件目录。完整步骤见 [生产运行手册](./docs/operations-runbook.md)。

## 数据保留

- PPT 待处理上传默认保留 24 小时。
- PPT 生成文件固定保留 7 天；到期后文件不可下载，项目元数据继续保留。
- 图片生成结果固定保留 7 天；主动保存到“我的素材库”的独立副本不受影响。
- 图片任务私有参考图默认保留 24 小时或至任务结束。
- 每用户图片文件默认上限 1GB、2000 个；PPT 待处理上传默认上限 200MB、50 个。
- 孤儿文件和待处理上传的清理周期可通过 [`.env.example`](./.env.example) 中的环境变量调整。

## 质量门禁

```bash
npm test
npm run lint
npx tsc --noEmit
npm run secrets:check
npm run supply-chain:check
npm run compose:isolation:check
npm run db:indexes:check
npm run build
npm run image-worker:build
npm run ppt-worker:build
npm run ppt-requirements:check
npm run ppt-agent:check-tools
PPT_PYTHON_CMD=python3 npm run ppt-quality:check
npm run backup:check-integration
```

PPT 质量回归会校验固定上游版本、12 套模板和 60 个实际渲染页面。GitHub Actions 还会运行真实 PostgreSQL 图片队列、PPT 队列与退款、存储保留、备份恢复、容器构建与 High/Critical 漏洞扫描，以及临时环境中的注册、登录、跨用户隔离和图片/PPT 页面验收。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Web 开发服务器 |
| `npm run image-worker:dev` | 启动本地图片 Worker |
| `npm run ppt-worker:dev` | 启动本地 PPT Worker |
| `npm test` | 运行 Vitest 测试 |
| `npm run build` | 校验 PPT Master、生成 Prisma Client 并构建 Next.js |
| `npm run secrets:check` | 扫描仓库中的高置信度密钥和硬编码口令模式 |
| `npm run supply-chain:check` | 检查外部镜像 digest 和 GitHub Action commit 固定状态 |
| `npm run compose:isolation:check` | 检查 Compose 网络、端口、权限、资源和日志隔离 |
| `npm run db:indexes:check` | 在已迁移 PostgreSQL 中校验关键查询与外键索引 |
| `npm run ppt-requirements:lock` | 用固定 Python/pip-tools 工具链更新 PPT Python 依赖锁 |
| `npm run ppt-requirements:check` | 检查 PPT Python 依赖清单与锁文件是否同步 |
| `npm run ppt-quality:check` | 检查并渲染 PPT 模板质量基线 |
| `npm run prod:check-env` | 检查生产环境变量 |
| `npm run prod:compose -- <参数>` | 加载 `.env.production` 后运行生产 Compose 命令 |
| `npm run prod:check-user-journey -- <base-url>` | 验证注册、登录、会话隔离及图片/PPT 页面 |
| `npm run prod:backup` | 创建数据库和文件快照 |
| `npm run prod:backup:verify` | 校验快照完整性和可读取性 |
| `npm run prod:restore:drill` | 恢复到临时数据库并验证文件 |
| `npm run prod:restore` | 执行带保护的实际恢复 |

## 安全要点

- 不提交 `.env`、API Key、数据库备份或 `data/`。
- 管理员初始化凭据仅在一次性 seed 或管理员重置时提供，不要写入脚本或长期保留在生产环境。
- `ENCRYPTION_KEY` 必须是 64 位 hex；已保存 API Key 后更换密钥前必须先完成密钥迁移。
- 生产环境禁用 Mock 充值。
- 外部资源获取执行 SSRF、重定向、格式、大小和超时检查。
- 普通用户 BYOK Base URL 只允许公网 HTTPS，并在 DNS 解析和实际连接阶段阻断内网地址；管理员平台上游可连接受信任的内网服务。
- PPT Agent 只能使用项目目录内的受限文件工具和白名单 Python 入口。
- Web 与 Worker 以非 root 用户运行，根文件系统只读，并设置 CPU、内存和 PID 上限。
