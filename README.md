# AI 聚合站

一站式 AI 创作平台，聚合图片生成、视频生成等多个 AI 模块。当前图片创作工作台已跑通完整业务流程；视频、音频、文案、代码等模块仍是占位页，后续可按图片模块的模式接入。

## 技术栈

- **框架**：Next.js 16（App Router）+ React 19
- **数据库**：SQLite + Prisma ORM
- **认证**：Auth.js v5（邮箱密码登录，JWT session）
- **UI**：Tailwind CSS v4 + shadcn/ui
- **校验**：Zod

## 功能

- 用户注册 / 登录，区分普通用户与管理员
- 积分系统：注册赠送、生成消耗、充值、管理员调整、失败退款，全程记录流水
- 图片创作工作台：会话列表、文生图、图生图、历史轮次、复用提示词、继续编辑
- API 配置：管理员配置平台上游，用户可配置自己的 API Key（BYOK）
- 生成历史、积分充值（Mock 支付）、个人资料
- 管理员后台：仪表盘、用户管理、生成记录、充值订单、系统设置、上游 API 配置

## 当前图片服务行为

图片模块现在使用 OpenAI 兼容的图片接口，不再自动回退到 Mock 图片。

- 用户启用自己的 API 配置时，走用户 Key，不消耗平台积分。
- 用户没有启用自己的 API 配置时，走管理员配置的平台上游，并按系统设置扣积分。
- 两者都没有配置时，生成接口会返回“图片服务尚未配置”。

支持的上游接口：

- 文生图：`{baseUrl}/images/generations`
- 图生图：`{baseUrl}/images/edits`

`baseUrl` 示例：`https://api.openai.com/v1`。模型示例：`gpt-image-1`。

## 快速开始

```bash
npm install
npm run db:push
npm run db:seed
npm run dev
```

打开 http://localhost:3000

默认管理员账号由 `.env` 配置并由 seed 创建：

- 邮箱：`admin@example.com`
- 密码：`admin123456`

进入后台后，先到 `/admin/api-config` 配置平台图片上游；或普通用户到 `/settings` 配置自己的 API Key。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | SQLite 数据库路径，默认 `file:./dev.db` |
| `AUTH_SECRET` | Auth.js 加密密钥，生产环境用 `npx auth secret` 生成 |
| `AUTH_TRUST_HOST` | Auth.js 主机信任配置，本地可设为 `true` |
| `ENCRYPTION_KEY` | API Key 加密密钥，必须是 64 位 hex，可用 `openssl rand -hex 32` 生成 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | 默认管理员账号 |

> `ENCRYPTION_KEY` 更换后，数据库中已保存的 API Key 将无法解密。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run lint` | 运行 ESLint |
| `npm run build` | 生成 Prisma Client 并执行生产构建 |
| `npm run start` | 启动生产服务 |
| `npm run db:push` | 同步 Prisma schema 到数据库 |
| `npm run db:seed` | 写入默认设置和管理员账号 |
| `npm run db:reset` | 重置数据库并重新 seed |

如果 Windows 上 `npm run build` 在 `prisma generate` 阶段出现 `query_engine-windows.dll.node` 重命名失败，通常是正在运行的 dev server 或其他 Node 进程占用了 Prisma 引擎文件。停止相关进程后重新执行即可。

## 项目结构

```text
src/
├── app/
│   ├── (marketing)/      首页
│   ├── (auth)/           登录、注册
│   ├── (app)/            用户区
│   ├── admin/            管理员后台
│   └── api/              认证、注册、图片生成、API 配置接口
├── components/           UI 组件
├── lib/
│   ├── auth.ts           Auth.js 完整配置
│   ├── auth.config.ts    Edge runtime 友好的认证配置
│   ├── credits.ts        积分系统
│   ├── image-workbench.ts 图片工作台服务端业务流
│   ├── modules.ts        模块注册表
│   ├── settings-config.ts 系统设置定义
│   └── providers/        AI 服务适配层
└── proxy.ts              路由保护
```

## 扩展模块

新增一个 AI 模块：

1. 在 `src/lib/modules.ts` 的 `MODULES` 数组加一项。
2. 在 `src/app/(app)/<模块>/page.tsx` 新建页面。
3. 占位模块可复用 `<ComingSoon />`；可用模块建议按图片模块拆分 API、服务端业务流、前端工作台。

接入新的图片上游：

1. 在 `src/lib/providers/` 新增 provider 实现，遵守 `ImageProvider` 接口。
2. 在 `src/lib/providers/resolve.ts` 或工厂层接入新的 provider。
3. 在管理员/用户 API 配置中保存对应 `baseUrl`、`apiKey` 和 `model`。

## 上线前检查

- 修改默认管理员密码，不要使用 `admin123456`。
- 使用强随机 `AUTH_SECRET`。
- 使用稳定且安全保存的 `ENCRYPTION_KEY`，不要频繁更换。
- 接入真实支付前，不要把当前 Mock 充值作为生产收款逻辑。
- 根据部署规模把 SQLite 迁移到 PostgreSQL、MySQL 等生产数据库。
- 给注册、登录、生成接口增加速率限制和审计策略。
