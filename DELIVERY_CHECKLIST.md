# 交付检查清单

## 本地质量

- [ ] `npm test`
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `npm run image-worker:build`
- [ ] `npm run ppt-worker:build`
- [ ] `npm run ppt-requirements:check`
- [ ] `npm run ppt-agent:check-tools`
- [ ] `PPT_PYTHON_BIN=python3 npm run ppt-quality:check`
- [ ] `npm run compose:isolation:check`
- [ ] Caddy 配置验证通过
- [ ] 容器日志轮转上限已确认
- [ ] 三个生产镜像无可修复的 High/Critical 漏洞

## 数据库

- [ ] `npx prisma validate`
- [ ] `npm run db:indexes:check`
- [ ] `DATABASE_INDEX_INTEGRATION_URL=<隔离测试库> npm run db:indexes:check-integration`
- [ ] `DATABASE_READINESS_INTEGRATION_URL=<隔离测试库> npm run db:readiness:check-integration`
- [ ] `QUEUE_CAPACITY_INTEGRATION_DATABASE_URL=<隔离测试库> npm run queue-capacity:check-integration`
- [ ] `npm run prod:check-env` 确认数据库连接池总预算保留足够运维连接
- [ ] 新数据库执行 `prisma migrate deploy` 成功
- [ ] 历史数据库基线比对成功，结构漂移场景能拒绝启动
- [ ] 本次 migration 已确认锁表时间和回滚方式

## 生产数据

- [ ] 已创建上线前快照
- [ ] `npm run prod:backup:verify -- --snapshot <path>` 通过
- [ ] 最近一次 `prod:restore:drill` 通过
- [ ] 快照已镜像到 VPS 之外的受控存储
- [ ] 已确认图片和 PPT 文件保留期限

## 运行状态

- [ ] `/api/health/live` 返回 200
- [ ] `/api/health/ready` 返回 200
- [ ] `npm run prod:health` 通过
- [ ] `image-worker` 数据库心跳和消费循环健康
- [ ] `ppt-worker` 数据库心跳和消费循环健康
- [ ] 临时环境注册、登录、会话隔离及图片/PPT 页面验收通过
- [ ] 队列中没有异常长期等待任务
- [ ] 磁盘、内存、CPU 和数据库连接数有告警

## 发布

- [ ] 已检查未提交改动范围
- [ ] 用户已在当前任务明确授权 commit
- [ ] 用户已在当前任务明确授权 push
- [ ] 用户已在当前任务明确授权部署
- [ ] 发布后验证登录、图片生成、PPT 生成、下载、积分扣减和失败退款
- [ ] 保留上一镜像或数据库/文件快照以便回滚
